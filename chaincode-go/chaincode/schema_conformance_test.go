package chaincode

// ============================================================
// Test #1 — Schema and RFC 8785 conformance test suite
//
// Run with: go test ./chaincode/... -run TestSchema -v
//           go test ./chaincode/... -run TestBinding -v
//           go test ./chaincode/... -run TestRFC8785 -v
//           go test ./chaincode/... -run TestV1V2RepresentationEquivalenceControl -v
// ============================================================

import (
	"crypto/sha256"
	"strings"
	"testing"
)

func validRecordJSON(hash string) string {
	return `{"collection":"c1","documentID":"d1","documentCategoryCode":"CONTRACT",` +
		`"name":"n","description":"desc","file":"` + hash + `","recipients":"",` +
		`"timestamp":"2026-07-26T00:00:00Z"}`
}

func TestSchemaConformance(t *testing.T) {
	hash := strings.Repeat("a", 64)
	valid := validRecordJSON(hash)

	cases := []struct {
		name          string
		json          string
		wantErr       bool
		wantErrSubstr string
	}{
		{
			name:    "valid record",
			json:    valid,
			wantErr: false,
		},
		{
			name: "unknown field",
			json: `{"collection":"c1","documentID":"d1","documentCategoryCode":"CONTRACT",` +
				`"name":"n","description":"desc","file":"` + hash + `","recipients":"",` +
				`"timestamp":"2026-07-26T00:00:00Z","extra":"x"}`,
			wantErr:       true,
			wantErrSubstr: "unknown JSON field",
		},
		{
			name: "missing required field (description)",
			json: `{"collection":"c1","documentID":"d1","documentCategoryCode":"CONTRACT",` +
				`"name":"n","file":"` + hash + `","recipients":"","timestamp":"2026-07-26T00:00:00Z"}`,
			wantErr:       true,
			wantErrSubstr: "required JSON field is missing",
		},
		{
			name: "duplicate field",
			json: `{"collection":"c1","collection":"c2","documentID":"d1","documentCategoryCode":"CONTRACT",` +
				`"name":"n","description":"desc","file":"` + hash + `","recipients":"","timestamp":"2026-07-26T00:00:00Z"}`,
			wantErr:       true,
			wantErrSubstr: "duplicate JSON field",
		},
		{
			name: "null required value",
			json: `{"collection":null,"documentID":"d1","documentCategoryCode":"CONTRACT",` +
				`"name":"n","description":"desc","file":"` + hash + `","recipients":"","timestamp":"2026-07-26T00:00:00Z"}`,
			wantErr:       true,
			wantErrSubstr: "cannot be null",
		},
		{
			name:          "not a JSON object (array)",
			json:          `["a","b"]`,
			wantErr:       true,
			wantErrSubstr: "must be a JSON object",
		},
		{
			name:          "trailing content after closing brace",
			json:          valid + `{}`,
			wantErr:       true,
			wantErrSubstr: "unexpected JSON value",
		},
		{
			name:          "empty input",
			json:          "",
			wantErr:       true,
			wantErrSubstr: "",
		},
		{
			name:          "truncated JSON",
			json:          `{"collection":"c1"`,
			wantErr:       true,
			wantErrSubstr: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateJSONObjectFields(
				[]byte(tc.json),
				privateDocumentAllowedFields,
				privateDocumentRequiredFields,
			)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
			if tc.wantErr && tc.wantErrSubstr != "" && !strings.Contains(err.Error(), tc.wantErrSubstr) {
				t.Fatalf("expected error to contain %q, got %q", tc.wantErrSubstr, err.Error())
			}
		})
	}
}

func TestBindingAndFormatChecks(t *testing.T) {
	hash := strings.Repeat("a", 64)
	base := validRecordJSON(hash)

	t.Run("collection binding mismatch", func(t *testing.T) {
		_, err := decodePrivateDocumentStrict([]byte(base), "wrong-collection", "d1")
		if err == nil || !strings.Contains(err.Error(), "collection mismatch") {
			t.Fatalf("expected collection mismatch error, got %v", err)
		}
	})

	t.Run("documentID binding mismatch", func(t *testing.T) {
		_, err := decodePrivateDocumentStrict([]byte(base), "c1", "wrong-id")
		if err == nil || !strings.Contains(err.Error(), "documentID mismatch") {
			t.Fatalf("expected documentID mismatch error, got %v", err)
		}
	})

	t.Run("invalid hash length", func(t *testing.T) {
		bad := strings.Replace(base, hash, "abc", 1)
		_, err := decodePrivateDocumentStrict([]byte(bad), "c1", "d1")
		if err == nil || !strings.Contains(err.Error(), "invalid document hash length") {
			t.Fatalf("expected hash-length error, got %v", err)
		}
	})

	t.Run("hash not valid hex", func(t *testing.T) {
		bad := strings.Replace(base, hash, strings.Repeat("z", 64), 1)
		_, err := decodePrivateDocumentStrict([]byte(bad), "c1", "d1")
		if err == nil || !strings.Contains(err.Error(), "not valid hexadecimal") {
			t.Fatalf("expected hex error, got %v", err)
		}
	})

	t.Run("malformed timestamp", func(t *testing.T) {
		bad := strings.Replace(base, "2026-07-26T00:00:00Z", "not-a-date", 1)
		_, err := decodePrivateDocumentStrict([]byte(bad), "c1", "d1")
		if err == nil || !strings.Contains(err.Error(), "not valid RFC3339") {
			t.Fatalf("expected timestamp error, got %v", err)
		}
	})

	t.Run("type mismatch (documentID as number, not string)", func(t *testing.T) {
		bad := `{"collection":"c1","documentID":123,"documentCategoryCode":"CONTRACT",` +
			`"name":"n","description":"desc","file":"` + hash + `","recipients":"",` +
			`"timestamp":"2026-07-26T00:00:00Z"}`
		_, err := decodePrivateDocumentStrict([]byte(bad), "c1", "d1")
		if err == nil || !strings.Contains(err.Error(), "cannot unmarshal number") {
			t.Fatalf("expected type-mismatch error mentioning 'cannot unmarshal number', got %v", err)
		}
	})

	t.Run("valid record decodes cleanly", func(t *testing.T) {
		doc, err := decodePrivateDocumentStrict([]byte(base), "c1", "d1")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if doc.File != hash {
			t.Fatalf("expected file hash %q, got %q", hash, doc.File)
		}
	})
}

func TestRFC8785CanonicalizationEquivalence(t *testing.T) {
	a := `{"collection":"c","documentID":"d","file":"h"}`
	b := `{"file":"h","documentID":"d","collection":"c"}`       // reordered
	c := `{ "collection" : "c" , "documentID":"d","file":"h" }` // insignificant whitespace
	d := `{"collection":"c","documentID":"d","file":"h" }`      // trailing space only

	ca, err := canonicalizeJSON([]byte(a))
	if err != nil {
		t.Fatalf("canonicalize a: %v", err)
	}
	cb, err := canonicalizeJSON([]byte(b))
	if err != nil {
		t.Fatalf("canonicalize b: %v", err)
	}
	cc, err := canonicalizeJSON([]byte(c))
	if err != nil {
		t.Fatalf("canonicalize c: %v", err)
	}
	cd, err := canonicalizeJSON([]byte(d))
	if err != nil {
		t.Fatalf("canonicalize d: %v", err)
	}

	if string(ca) != string(cb) {
		t.Fatalf("property reordering should not change canonical output:\n a=%q\n b=%q", ca, cb)
	}
	if string(ca) != string(cc) {
		t.Fatalf("insignificant whitespace should not change canonical output:\n a=%q\n c=%q", ca, cc)
	}
	if string(ca) != string(cd) {
		t.Fatalf("trailing whitespace should not change canonical output:\n a=%q\n d=%q", ca, cd)
	}

	t.Run("empty input rejected", func(t *testing.T) {
		if _, err := canonicalizeJSON([]byte("")); err == nil {
			t.Fatalf("expected error for empty input")
		}
	})

	t.Run("nested structures canonicalize deterministically", func(t *testing.T) {
		x := `{"b":{"z":1,"a":2},"a":[3,2,1]}`
		y := `{"a":[3,2,1],"b":{"a":2,"z":1}}`
		cx, err := canonicalizeJSON([]byte(x))
		if err != nil {
			t.Fatalf("canonicalize x: %v", err)
		}
		cy, err := canonicalizeJSON([]byte(y))
		if err != nil {
			t.Fatalf("canonicalize y: %v", err)
		}
		if string(cx) != string(cy) {
			t.Fatalf("nested object key order should not change canonical output:\n x=%q\n y=%q", cx, cy)
		}
	})

	t.Run("array element order IS significant (must NOT be normalized)", func(t *testing.T) {
		x := `{"a":[1,2,3]}`
		y := `{"a":[3,2,1]}`
		cx, _ := canonicalizeJSON([]byte(x))
		cy, _ := canonicalizeJSON([]byte(y))
		if string(cx) == string(cy) {
			t.Fatalf("array order was incorrectly normalized away, this would be a JCS conformance bug")
		}
	})

	t.Run("negative_zero_(-0)_is_rejected_per_RFC_8785_errata_7920", func(t *testing.T) {
		_, err := canonicalizeJSON([]byte(`{"value":-0}`))
		if err == nil {
			t.Fatalf("expected error for -0 per RFC 8785 Errata ID 7920, got success")
		}
	})

	t.Run("equivalent unicode string escaping", func(t *testing.T) {
		x := `{"name":"caf\u00e9"}`
		y := `{"name":"café"}`
		cx, err := canonicalizeJSON([]byte(x))
		if err != nil {
			t.Fatalf("canonicalize x: %v", err)
		}
		cy, err := canonicalizeJSON([]byte(y))
		if err != nil {
			t.Fatalf("canonicalize y: %v", err)
		}
		if string(cx) != string(cy) {
			t.Fatalf("equivalent unicode escaping should canonicalize identically:\n x=%q\n y=%q", cx, cy)
		}
	})

	t.Run("large integer / scientific notation serializes per RFC 8785 §3.2.2.3", func(t *testing.T) {
		out, err := canonicalizeJSON([]byte(`{"value":1e10}`))
		if err != nil {
			t.Fatalf("canonicalize 1e10: %v", err)
		}
		want := `{"value":10000000000}`
		if string(out) != want {
			t.Fatalf("expected %q per RFC 8785 numeric serialization rules, got %q", want, out)
		}
	})

	t.Run("lone surrogate is rejected during canonicalization", func(t *testing.T) {
		_, err := canonicalizeJSON([]byte(`{"value":"\uD800"}`))
		if err == nil || !strings.Contains(err.Error(), "Missing surrogate") {
			t.Fatalf("expected lone-surrogate rejection error, got %v", err)
		}
	})

	t.Run("objects inside arrays canonicalize deterministically per element", func(t *testing.T) {
		x := `{"a":[{"z":1,"y":2},{"b":1,"a":2}]}`
		y := `{"a":[{"y":2,"z":1},{"a":2,"b":1}]}`
		cx, err := canonicalizeJSON([]byte(x))
		if err != nil {
			t.Fatalf("canonicalize x: %v", err)
		}
		cy, err := canonicalizeJSON([]byte(y))
		if err != nil {
			t.Fatalf("canonicalize y: %v", err)
		}
		if string(cx) != string(cy) {
			t.Fatalf("key order within array elements should not change canonical output:\n x=%q\n y=%q", cx, cy)
		}
	})

	t.Run("objects inside arrays still preserve array element ORDER", func(t *testing.T) {
		x := `{"a":[{"k":1},{"k":2}]}`
		y := `{"a":[{"k":2},{"k":1}]}`
		cx, _ := canonicalizeJSON([]byte(x))
		cy, _ := canonicalizeJSON([]byte(y))
		if string(cx) == string(cy) {
			t.Fatalf("array element order was incorrectly normalized away for object-valued elements")
		}
	})
}

func TestV1V2RepresentationEquivalenceControl(t *testing.T) {
	hash := strings.Repeat("a", 64)

	canonicalInput := `{"collection":"c1","description":"desc","documentCategoryCode":"CONTRACT","documentID":"d1","file":"` + hash + `","name":"café","recipients":"","timestamp":"2026-07-26T00:00:00Z"}`

	canonicalCommitted, err := canonicalizeJSON([]byte(canonicalInput))
	if err != nil {
		t.Fatalf("canonicalize committed record: %v", err)
	}

	committedHash := sha256.Sum256(canonicalCommitted)

	cases := []struct {
		name string
		raw  string
	}{
		{
			name: "reordered properties",
			raw:  `{"timestamp":"2026-07-26T00:00:00Z","recipients":"","name":"café","file":"` + hash + `","description":"desc","documentID":"d1","documentCategoryCode":"CONTRACT","collection":"c1"}`,
		},
		{
			name: "insignificant whitespace",
			raw:  `{ "collection" : "c1", "description" : "desc", "documentCategoryCode" : "CONTRACT", "documentID" : "d1", "file" : "` + hash + `", "name" : "café", "recipients" : "", "timestamp" : "2026-07-26T00:00:00Z" }`,
		},
		{
			name: "equivalent unicode escaping",
			raw:  `{"collection":"c1","description":"desc","documentCategoryCode":"CONTRACT","documentID":"d1","file":"` + hash + `","name":"caf\u00e9","recipients":"","timestamp":"2026-07-26T00:00:00Z"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawHash := sha256.Sum256([]byte(tc.raw))

			if rawHash == committedHash {
				t.Fatalf("V1-style raw comparison unexpectedly matched committed canonical hash")
			}

			canonicalized, err := canonicalizeJSON([]byte(tc.raw))
			if err != nil {
				t.Fatalf("canonicalize equivalent representation: %v", err)
			}

			canonicalHash := sha256.Sum256(canonicalized)

			if canonicalHash != committedHash {
				t.Fatalf("V2-style canonical comparison should match committed canonical hash")
			}

			if _, err := decodePrivateDocumentStrict(
				[]byte(tc.raw),
				"c1",
				"d1",
			); err != nil {
				t.Fatalf("V3-style strict schema validation should accept equivalent valid record: %v", err)
			}
		})
	}
}
