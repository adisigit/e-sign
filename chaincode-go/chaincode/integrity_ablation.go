package chaincode

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func getPrivateRecord(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
) ([]byte, error) {
	rawValue, err := ctx.GetStub().GetPrivateData(
		collection,
		documentID,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"failed to read private document: %w",
			err,
		)
	}

	if rawValue == nil {
		return nil, fmt.Errorf(
			"document not found: %s",
			documentID,
		)
	}

	return rawValue, nil
}

func compareWithPdcHash(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	value []byte,
) (bool, error) {
	ledgerHash, err :=
		ctx.GetStub().GetPrivateDataHash(
			collection,
			documentID,
		)

	if err != nil {
		return false, fmt.Errorf(
			"failed to get PDC hash: %w",
			err,
		)
	}

	if ledgerHash == nil {
		return false, fmt.Errorf(
			"PDC hash not found for document: %s",
			documentID,
		)
	}

	localDigest := sha256.Sum256(value)

	return bytes.Equal(
		localDigest[:],
		ledgerHash,
	), nil
}

func buildChecks(
	schema interface{},
	canonicalization interface{},
	pdcHash interface{},
	documentHash interface{},
) map[string]interface{} {
	return map[string]interface{}{
		"schema":           schema,
		"canonicalization": canonicalization,
		"pdcHash":          pdcHash,
		"documentHash":     documentHash,
	}
}

func (s *SmartContract) verifyV0ContentOnly(
	rawValue []byte,
	presentedDocHashHex string,
) (map[string]interface{}, error) {

	var raw map[string]interface{}

	if err := json.Unmarshal(rawValue, &raw); err != nil {
		return map[string]interface{}{
			"variant":  "V0",
			"status":   "CONTENT_REFERENCE_PARSE_FAILURE",
			"detected": true,
			"checks": buildChecks(
				nil,
				nil,
				nil,
				false,
			),
		}, nil
	}

	storedFileHash, ok := raw["file"].(string)

	if !ok || storedFileHash == "" {
		return map[string]interface{}{
			"variant":  "V0",
			"status":   "CONTENT_REFERENCE_UNAVAILABLE",
			"detected": true,
			"checks": buildChecks(
				nil,
				nil,
				nil,
				false,
			),
		}, nil
	}

	documentValid := presentedDocHashHex == storedFileHash

	if !documentValid {
		return map[string]interface{}{
			"variant":            "V0",
			"status":             "DOCUMENT_MODIFIED",
			"detected":           true,
			"storedDocumentHash": storedFileHash,
			"checks": buildChecks(
				nil,
				nil,
				nil,
				false,
			),
		}, nil
	}

	return map[string]interface{}{
		"variant":            "V0",
		"status":             "CONTENT_INTACT",
		"detected":           false,
		"storedDocumentHash": storedFileHash,
		"checks": buildChecks(
			nil,
			nil,
			nil,
			true,
		),
	}, nil
}

func (s *SmartContract) verifyV1RawRecord(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	rawValue []byte,
) (map[string]interface{}, error) {
	valid, err := compareWithPdcHash(
		ctx,
		collection,
		documentID,
		rawValue,
	)

	if err != nil {
		return nil, err
	}

	if !valid {
		return map[string]interface{}{
			"variant":  "V1",
			"status":   "RAW_RECORD_MISMATCH",
			"detected": true,
			"checks": buildChecks(
				nil,
				nil,
				false,
				nil,
			),
		}, nil
	}

	return map[string]interface{}{
		"variant":  "V1",
		"status":   "RAW_RECORD_INTACT",
		"detected": false,
		"checks": buildChecks(
			nil,
			nil,
			true,
			nil,
		),
	}, nil
}

func (s *SmartContract) verifyV2CanonicalRecord(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	rawValue []byte,
) (map[string]interface{}, error) {
	canonicalValue, err := canonicalizeJSON(rawValue)

	if err != nil {
		return map[string]interface{}{
			"variant":  "V2",
			"status":   "CANONICALIZATION_FAILURE",
			"detected": true,
			"checks": buildChecks(
				nil,
				false,
				nil,
				nil,
			),
		}, nil
	}

	valid, err := compareWithPdcHash(
		ctx,
		collection,
		documentID,
		canonicalValue,
	)

	if err != nil {
		return nil, err
	}

	if !valid {
		return map[string]interface{}{
			"variant":  "V2",
			"status":   "CANONICAL_RECORD_MISMATCH",
			"detected": true,
			"checks": buildChecks(
				nil,
				true,
				false,
				nil,
			),
		}, nil
	}

	return map[string]interface{}{
		"variant":  "V2",
		"status":   "CANONICAL_RECORD_INTACT",
		"detected": false,
		"checks": buildChecks(
			nil,
			true,
			true,
			nil,
		),
	}, nil
}

func (s *SmartContract) verifyV3SchemaCanonicalRecord(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	rawValue []byte,
) (map[string]interface{}, error) {
	_, err := decodePrivateDocumentStrict(
		rawValue,
		collection,
		documentID,
	)

	if err != nil {
		return map[string]interface{}{
			"variant":  "V3",
			"status":   "SCHEMA_VIOLATION",
			"detected": true,
			"details":  err.Error(),
			"checks": buildChecks(
				false,
				nil,
				nil,
				nil,
			),
		}, nil
	}

	canonicalValue, err := canonicalizeJSON(rawValue)

	if err != nil {
		return map[string]interface{}{
			"variant":  "V3",
			"status":   "CANONICALIZATION_FAILURE",
			"detected": true,
			"details":  err.Error(),
			"checks": buildChecks(
				true,
				false,
				nil,
				nil,
			),
		}, nil
	}

	valid, err := compareWithPdcHash(
		ctx,
		collection,
		documentID,
		canonicalValue,
	)

	if err != nil {
		return nil, err
	}

	if !valid {
		return map[string]interface{}{
			"variant":  "V3",
			"status":   "RECORD_COMPROMISED",
			"detected": true,
			"checks": buildChecks(
				true,
				true,
				false,
				nil,
			),
		}, nil
	}

	return map[string]interface{}{
		"variant":  "V3",
		"status":   "RECORD_INTACT",
		"detected": false,
		"checks": buildChecks(
			true,
			true,
			true,
			nil,
		),
	}, nil
}

func (s *SmartContract) verifyV4FullTwoStage(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	rawValue []byte,
	presentedDocHashHex string,
) (map[string]interface{}, error) {
	record, err := decodePrivateDocumentStrict(
		rawValue,
		collection,
		documentID,
	)

	if err != nil {
		return map[string]interface{}{
			"variant":         "V4",
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_SCHEMA_VIOLATION",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": fmt.Sprintf(
				"PRIVATE RECORD SCHEMA VIOLATION: %v",
				err,
			),
			"layer1":   false,
			"layer2":   nil,
			"detected": true,

			"checks": buildChecks(
				false,
				nil,
				nil,
				nil,
			),
		}, nil
	}

	canonicalValue, err := canonicalizeJSON(rawValue)

	if err != nil {
		return map[string]interface{}{
			"variant":         "V4",
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_CANONICALIZATION_FAILURE",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": fmt.Sprintf(
				"PRIVATE RECORD CANONICALIZATION FAILURE: %v",
				err,
			),
			"layer1":   false,
			"layer2":   nil,
			"detected": true,

			"checks": buildChecks(
				true,
				false,
				nil,
				nil,
			),
		}, nil
	}

	layer1Valid, err :=
		compareWithPdcHash(
			ctx,
			collection,
			documentID,
			canonicalValue,
		)

	if err != nil {
		return nil, err
	}

	if !layer1Valid {
		return map[string]interface{}{
			"variant":         "V4",
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_COMPROMISED",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": "PRIVATE RECORD COMPROMISED! " +
				"PDC hash mismatch detected. " +
				"Layer 2 was not evaluated.",

			"layer1":   false,
			"layer2":   nil,
			"detected": true,

			"checks": buildChecks(
				true,
				true,
				false,
				nil,
			),
		}, nil
	}

	layer2Valid := presentedDocHashHex == record.File

	if !layer2Valid {
		return map[string]interface{}{
			"variant":         "V4",
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "DOCUMENT_MODIFIED",
			"failedLayer":     "layer2_content",
			"criticalWarning": "DOCUMENT COMPROMISED! " +
				"Off-chain document content does not match " +
				"the registered hash.",

			"layer1":   true,
			"layer2":   false,
			"detected": true,

			"checks": buildChecks(
				true,
				true,
				true,
				false,
			),
		}, nil
	}

	return map[string]interface{}{
		"variant":         "V4",
		"documentID":      documentID,
		"integrityStatus": true,
		"status":          "INTACT",
		"layer1":          true,
		"layer2":          true,
		"detected":        false,

		"checks": buildChecks(
			true,
			true,
			true,
			true,
		),
	}, nil
}

func (s *SmartContract) VerifyAblationVariant(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	presentedDocHashHex string,
	variant string,
) (map[string]interface{}, error) {
	rawValue, err := getPrivateRecord(
		ctx,
		collection,
		documentID,
	)

	if err != nil {
		return nil, err
	}

	variant =
		strings.ToUpper(
			strings.TrimSpace(variant),
		)

	switch variant {

	case "V0":
		return s.verifyV0ContentOnly(
			rawValue,
			presentedDocHashHex,
		)

	case "V1":
		return s.verifyV1RawRecord(
			ctx,
			collection,
			documentID,
			rawValue,
		)

	case "V2":
		return s.verifyV2CanonicalRecord(
			ctx,
			collection,
			documentID,
			rawValue,
		)

	case "V3":
		return s.verifyV3SchemaCanonicalRecord(
			ctx,
			collection,
			documentID,
			rawValue,
		)

	case "V4":
		return s.verifyV4FullTwoStage(
			ctx,
			collection,
			documentID,
			rawValue,
			presentedDocHashHex,
		)

	default:
		return nil, fmt.Errorf(
			"unknown verification variant %q; "+
				"expected V0, V1, V2, V3, or V4",
			variant,
		)
	}
}
