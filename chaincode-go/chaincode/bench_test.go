package chaincode

import (
	"crypto/sha256"
	"encoding/json"
	"runtime"
	"strings"
	"testing"
)

var (
	sampleRawJSON = mustBuildSampleRawJSON()

	benchmarkAnySink   any
	benchmarkBoolSink  bool
	benchmarkBytesSink []byte
	benchmarkHashSink  [32]byte
	benchmarkMapSink   map[string]interface{}

	benchmarkPresentedHash = buildRuntimeString(
		"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
	)
	benchmarkStoredHash = buildRuntimeString(
		"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
	)
)

func buildRuntimeString(s string) string {

	return strings.Clone(s)
}

func mustBuildSampleRawJSON() []byte {
	doc := PrivateDocumentWebhook{
		Collection:           "org1PrivateCollection",
		ID:                   "doc-bench-0001",
		DocumentCategoryCode: "CONTRACT",
		Name:                 "Sample Agreement",
		Description:          "Benchmark payload for cost decomposition",
		File:                 "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
		Recipients:           "usr-recipient-0001",
		Timestamp:            "2025-01-01T00:00:00Z",
	}

	raw, err := json.Marshal(doc)
	if err != nil {
		panic(err)
	}
	return raw
}

func BenchmarkLenientParsing(b *testing.B) {
	b.ReportAllocs()
	b.SetBytes(int64(len(sampleRawJSON)))

	for i := 0; i < b.N; i++ {
		var raw map[string]interface{}
		if err := json.Unmarshal(sampleRawJSON, &raw); err != nil {
			b.Fatalf("unexpected unmarshal failure: %v", err)
		}

		benchmarkMapSink = raw
		benchmarkAnySink = raw["file"]
	}

	runtime.KeepAlive(benchmarkMapSink)
	runtime.KeepAlive(benchmarkAnySink)
}

func BenchmarkSchemaValidation(b *testing.B) {
	b.ReportAllocs()
	b.SetBytes(int64(len(sampleRawJSON)))

	for i := 0; i < b.N; i++ {
		doc, err := decodePrivateDocumentStrict(
			sampleRawJSON,
			"org1PrivateCollection",
			"doc-bench-0001",
		)
		if err != nil {
			b.Fatalf("unexpected schema failure: %v", err)
		}

		benchmarkAnySink = doc
	}

	runtime.KeepAlive(benchmarkAnySink)
}

func BenchmarkCanonicalization(b *testing.B) {
	b.ReportAllocs()
	b.SetBytes(int64(len(sampleRawJSON)))

	for i := 0; i < b.N; i++ {
		canonical, err := canonicalizeJSON(sampleRawJSON)
		if err != nil {
			b.Fatalf("unexpected canonicalization failure: %v", err)
		}
		benchmarkBytesSink = canonical
	}

	runtime.KeepAlive(benchmarkBytesSink)
}

func BenchmarkHashComputation(b *testing.B) {
	canonical, err := canonicalizeJSON(sampleRawJSON)
	if err != nil {
		b.Fatalf("unexpected canonicalization setup failure: %v", err)
	}

	b.ReportAllocs()
	b.SetBytes(int64(len(canonical)))
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		benchmarkHashSink = sha256.Sum256(canonical)
	}

	runtime.KeepAlive(benchmarkHashSink)
	runtime.KeepAlive(canonical)
}

func BenchmarkDocumentHashCompare(b *testing.B) {
	presented := benchmarkPresentedHash
	stored := benchmarkStoredHash

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		benchmarkBoolSink = (presented == stored)
	}

	runtime.KeepAlive(presented)
	runtime.KeepAlive(stored)
	runtime.KeepAlive(benchmarkBoolSink)
}

func BenchmarkSchemaAndCanonicalization(b *testing.B) {
	b.ReportAllocs()
	b.SetBytes(int64(len(sampleRawJSON)))

	for i := 0; i < b.N; i++ {
		doc, err := decodePrivateDocumentStrict(
			sampleRawJSON,
			"org1PrivateCollection",
			"doc-bench-0001",
		)
		if err != nil {
			b.Fatalf("unexpected schema failure: %v", err)
		}

		canonical, err := canonicalizeJSON(sampleRawJSON)
		if err != nil {
			b.Fatalf("unexpected canonicalization failure: %v", err)
		}

		benchmarkAnySink = doc
		benchmarkBytesSink = canonical
	}

	runtime.KeepAlive(benchmarkAnySink)
	runtime.KeepAlive(benchmarkBytesSink)
}

func BenchmarkLocalLayer1Compute(b *testing.B) {
	expectedCanonical, err := canonicalizeJSON(sampleRawJSON)
	if err != nil {
		b.Fatalf("unexpected canonicalization setup failure: %v", err)
	}
	expectedHash := sha256.Sum256(expectedCanonical)

	b.ReportAllocs()
	b.SetBytes(int64(len(sampleRawJSON)))
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		doc, err := decodePrivateDocumentStrict(
			sampleRawJSON,
			"org1PrivateCollection",
			"doc-bench-0001",
		)
		if err != nil {
			b.Fatalf("unexpected schema failure: %v", err)
		}

		canonical, err := canonicalizeJSON(sampleRawJSON)
		if err != nil {
			b.Fatalf("unexpected canonicalization failure: %v", err)
		}

		actualHash := sha256.Sum256(canonical)

		benchmarkAnySink = doc
		benchmarkBytesSink = canonical
		benchmarkHashSink = actualHash
		benchmarkBoolSink = (actualHash == expectedHash)
	}

	runtime.KeepAlive(expectedHash)
	runtime.KeepAlive(benchmarkAnySink)
	runtime.KeepAlive(benchmarkBytesSink)
	runtime.KeepAlive(benchmarkHashSink)
	runtime.KeepAlive(benchmarkBoolSink)
}
