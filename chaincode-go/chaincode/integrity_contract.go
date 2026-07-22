package chaincode

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) ReadDocumentByIDWithIntegrityCheckWebhook(ctx contractapi.TransactionContextInterface, collection string, documentID string) (map[string]interface{}, error) {
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

	document, err := decodePrivateDocumentRaw(
		rawValue,
	)

	if err != nil {
		return map[string]interface{}{
			"document":        document,
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_SCHEMA_VIOLATION",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": fmt.Sprintf(
				"PRIVATE RECORD SCHEMA VIOLATION: %v",
				err,
			),
			"layer1": false,
			"layer2": nil,
		}, nil
	}

	canonicalValue, err := canonicalizeJSON(rawValue)
	if err != nil {
		return map[string]interface{}{
			"document":        document,
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_CANONICALIZATION_FAILURE",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": fmt.Sprintf(
				"PRIVATE RECORD CANONICALIZATION FAILURE: %v",
				err,
			),
			"layer1": false,
			"layer2": nil,
		}, nil
	}

	isValid, _ := s.validateDataHash(ctx, collection, documentID, canonicalValue)

	if !isValid {
		return map[string]interface{}{
			"document":        document,
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_COMPROMISED",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": "PRIVATE RECORD COMPROMISED! The canonical record does not match the ledger-committed PDC hash.",
			"layer1":          false,
			"layer2":          nil,
		}, nil
	}

	return map[string]interface{}{
		"document":        document,
		"documentID":      documentID,
		"integrityStatus": true,
		"status":          "VALID",
		"layer1":          true,
	}, nil
}

func (s *SmartContract) VerifyDocumentShortCircuit(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	presentedDocHashHex string,
) (map[string]interface{}, error) {
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

	record, err := decodePrivateDocumentStrict(
		rawValue,
		collection,
		documentID,
	)

	if err != nil {
		return map[string]interface{}{
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_SCHEMA_VIOLATION",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": fmt.Sprintf(
				"PRIVATE RECORD SCHEMA VIOLATION: %v",
				err,
			),
			"layer1": false,
			"layer2": nil,
		}, nil
	}

	canonicalValue, err := canonicalizeJSON(rawValue)
	if err != nil {
		return map[string]interface{}{
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_CANONICALIZATION_FAILURE",
			"failedLayer":     "layer1_private_record",
			"criticalWarning": fmt.Sprintf(
				"PRIVATE RECORD CANONICALIZATION FAILURE: %v",
				err,
			),
			"layer1": false,
			"layer2": nil,
		}, nil
	}

	layer1Valid, _ := s.validateDataHash(ctx, collection, documentID, canonicalValue)

	if !layer1Valid {
		return map[string]interface{}{
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "PDC_RECORD_COMPROMISED",
			"failedLayer":     "layer1_metadata",
			"criticalWarning": "PRIVATE RECORD COMPROMISED! Metadata hash mismatch detected. Layer 2 (document content) was not evaluated.",
			"layer1":          false,
			"layer2":          nil,
		}, nil
	}

	layer2Valid := presentedDocHashHex == record.File

	if !layer2Valid {
		return map[string]interface{}{
			"documentID":      documentID,
			"integrityStatus": false,
			"status":          "DOCUMENT_MODIFIED",
			"failedLayer":     "layer2_content",
			"criticalWarning": "DOCUMENT COMPROMISED! Off-chain document content does not match the registered hash.",
			"layer1":          true,
			"layer2":          false,
		}, nil
	}

	return map[string]interface{}{
		"documentID":      documentID,
		"integrityStatus": true,
		"status":          "INTACT",
		"layer1":          true,
		"layer2":          true,
	}, nil
}

func (s *SmartContract) ReadAllLogByDocumentIDWithIntegrityCheck(
	ctx contractapi.TransactionContextInterface,
	collectionLog string,
	documentID string,
) (map[string]interface{}, error) {
	query := fmt.Sprintf(
		`{"selector":{"documentID":"%s"}}`,
		documentID,
	)

	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(
		collectionLog,
		query,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"failed to query private logs: %w",
			err,
		)
	}
	defer resultsIterator.Close()

	if !resultsIterator.HasNext() {
		return nil, fmt.Errorf(
			"log document not found: %s",
			documentID,
		)
	}

	var validLogs []*PrivateLogDocumentWebhook
	var tamperedLogs []string
	var schemaInvalidLogs []string

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, fmt.Errorf(
				"failed to read private-log query result: %w",
				err,
			)
		}

		logRecord, err := decodePrivateLogStrict(
			queryResponse.Value,
			collectionLog,
			queryResponse.Key,
			documentID,
		)
		if err != nil {
			schemaInvalidLogs = append(
				schemaInvalidLogs,
				queryResponse.Key,
			)
			continue
		}

		canonicalValue, err := canonicalizeJSON(
			queryResponse.Value,
		)
		if err != nil {
			schemaInvalidLogs = append(
				schemaInvalidLogs,
				queryResponse.Key,
			)
			continue
		}

		isValid, err := s.validateDataHash(
			ctx,
			collectionLog,
			queryResponse.Key,
			canonicalValue,
		)
		if err != nil {
			return nil, fmt.Errorf(
				"failed to validate log %s: %w",
				queryResponse.Key,
				err,
			)
		}

		if !isValid {
			tamperedLogs = append(
				tamperedLogs,
				queryResponse.Key,
			)
			continue
		}

		// Only return trusted log values.
		validLogs = append(validLogs, logRecord)
	}

	tamperedCount :=
		len(tamperedLogs) + len(schemaInvalidLogs)

	result := map[string]interface{}{
		"logs":              validLogs,
		"validCount":        len(validLogs),
		"tamperedCount":     tamperedCount,
		"tamperedLogs":      tamperedLogs,
		"schemaInvalidLogs": schemaInvalidLogs,
		"auditIntact":       tamperedCount == 0,
	}

	if tamperedCount > 0 {
		result["criticalWarning"] =
			"AUDIT TRAIL COMPROMISED! One or more logs failed schema or hash validation."
	}

	return result, nil
}
