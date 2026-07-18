package chaincode

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) ReadDocumentByIDWithIntegrityCheckWebhook(ctx contractapi.TransactionContextInterface, collection string, documentID string) (map[string]interface{}, error) {
	query := fmt.Sprintf(`{"selector":{"documentID":"%s"}}`, documentID)
	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(collection, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query document: %v", err)
	}
	defer resultsIterator.Close()

	if !resultsIterator.HasNext() {
		return nil, fmt.Errorf("document not found: %s", documentID)
	}

	queryResponse, err := resultsIterator.Next()
	if err != nil {
		return nil, fmt.Errorf("failed to get query response: %v", err)
	}

	var document PrivateDocumentWebhook
	err = json.Unmarshal(queryResponse.Value, &document)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal document: %v", err)
	}

	reMarshaled, err := json.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal document: %v", err)
	}

	isValid, _ := s.validateDataHash(ctx, collection, documentID, reMarshaled)

	result := map[string]interface{}{
		"document":        document,
		"documentID":      documentID,
		"integrityStatus": isValid,
	}

	if !isValid {
		result["criticalWarning"] = "DOCUMENT COMPROMISED! Document has been tampered. Investigation required."
		result["tamperedDocument"] = documentID
		result["status"] = "TAMPERED"
	} else {
		result["status"] = "VALID"
	}

	return result, nil
}

func (s *SmartContract) VerifyDocumentShortCircuit(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
	presentedDocHashHex string,
) (map[string]interface{}, error) {

	query := fmt.Sprintf(`{"selector":{"documentID":"%s"}}`, documentID)
	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(collection, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query document: %v", err)
	}
	defer resultsIterator.Close()

	if !resultsIterator.HasNext() {
		return nil, fmt.Errorf("document not found: %s", documentID)
	}
	queryResponse, err := resultsIterator.Next()
	if err != nil {
		return nil, fmt.Errorf("failed to get query response: %v", err)
	}

	var record PrivateDocumentWebhook
	if err := json.Unmarshal(queryResponse.Value, &record); err != nil {
		return nil, fmt.Errorf("failed to unmarshal document: %v", err)
	}

	reMarshaled, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal document: %v", err)
	}

	layer1Valid, _ := s.validateDataHash(ctx, collection, documentID, reMarshaled)

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

func (s *SmartContract) ReadAllLogByDocumentIDWithIntegrityCheck(ctx contractapi.TransactionContextInterface, collectionLog string, documentID string) (map[string]interface{}, error) {
	query := fmt.Sprintf(`{"selector":{"documentID":"%s"}}`, documentID)

	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(collectionLog, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get log documents: %v", err)
	}
	defer resultsIterator.Close()

	if !resultsIterator.HasNext() {
		return nil, fmt.Errorf("log document not found: %s", documentID)
	}

	var logs []*PrivateLogDocumentWebhook
	var tamperedLogs []string
	validCount := 0
	tamperedCount := 0

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var log PrivateLogDocumentWebhook
		err = json.Unmarshal(queryResponse.Value, &log)
		if err != nil {
			return nil, err
		}

		// Marshal ulang untuk normalize
		reMarshaled, err := json.Marshal(log)
		if err != nil {
			return nil, err
		}

		// Validate using DIRECT data
		isValid, _ := s.validateDataHash(ctx, collectionLog, queryResponse.Key, reMarshaled)

		logs = append(logs, &log)

		if isValid {
			validCount++
		} else {
			tamperedCount++
			tamperedLogs = append(tamperedLogs, queryResponse.Key)
		}
	}

	result := map[string]interface{}{
		"logs":          logs,
		"totalCount":    len(logs),
		"validCount":    validCount,
		"tamperedCount": tamperedCount,
		"tamperedLogs":  tamperedLogs,
		"auditIntact":   tamperedCount == 0,
	}

	if tamperedCount > 0 {
		result["criticalWarning"] = "AUDIT TRAIL COMPROMISED! Logs have been tampered. Investigation required."
	}

	return result, nil
}
