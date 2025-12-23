package chaincode

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) ReadAllDocumentByOrgWithIntegrityCheck(ctx contractapi.TransactionContextInterface, collection string) (map[string]interface{}, error) {
	resultsIterator, err := ctx.GetStub().GetPrivateDataByRange(collection, "", "")
	if err != nil {
		return nil, fmt.Errorf("failed to get documents from %s: %v", collection, err)
	}
	defer resultsIterator.Close()

	var documents []*PrivateDocument
	var corruptedDocs []string
	validCount := 0
	corruptedCount := 0

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		isValid, _ := s.validateDataHash(ctx, collection, queryResponse.Key, queryResponse.Value)

		var document PrivateDocument
		err = json.Unmarshal(queryResponse.Value, &document)
		if err != nil {
			return nil, err
		}

		documents = append(documents, &document)

		if isValid {
			validCount++
		} else {
			corruptedCount++
			corruptedDocs = append(corruptedDocs, queryResponse.Key)
		}
	}

	result := map[string]interface{}{
		"documents":       documents,
		"totalCount":      len(documents),
		"validCount":      validCount,
		"corruptedCount":  corruptedCount,
		"corruptedDocs":   corruptedDocs,
		"integrityStatus": corruptedCount == 0,
	}

	return result, nil
}

func (s *SmartContract) ReadAllLogByDocumentIDWithIntegrityCheck(ctx contractapi.TransactionContextInterface, collectionLog string, documentID string) (map[string]interface{}, error) {
	query := fmt.Sprintf(`{"selector":{"documentID":"%s"}}`, documentID)

	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(collectionLog, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get log documents: %v", err)
	}
	defer resultsIterator.Close()

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

func (s *SmartContract) VerifyPrivateDataIntegrity(ctx contractapi.TransactionContextInterface, collection string, documentID string) (*IntegrityCheckResult, error) {
	docJSON, err := ctx.GetStub().GetPrivateData(collection, documentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get private data: %v", err)
	}

	if docJSON == nil {
		return nil, fmt.Errorf("document not found in state")
	}

	currentHash := sha256.Sum256(docJSON)
	currentHashHex := hex.EncodeToString(currentHash[:])

	hashFromChain, err := ctx.GetStub().GetPrivateDataHash(collection, documentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get hash from blockchain: %v", err)
	}

	blockchainHashHex := hex.EncodeToString(hashFromChain)
	hashMatch := currentHashHex == blockchainHashHex

	result := &IntegrityCheckResult{
		DocumentID:        documentID,
		Collection:        collection,
		CurrentHashHex:    currentHashHex,
		BlockchainHashHex: blockchainHashHex,
		HashMatch:         hashMatch,
		DataIntact:        hashMatch,
	}

	if !hashMatch {
		result.Warning = "DATA INTEGRITY COMPROMISED! Manual manipulation detected."
	}

	return result, nil
}

func (s *SmartContract) VerifyAllDocumentsIntegrity(ctx contractapi.TransactionContextInterface, collection string) (map[string]interface{}, error) {
	resultsIterator, err := ctx.GetStub().GetPrivateDataByRange(collection, "", "")
	if err != nil {
		return nil, fmt.Errorf("failed to get documents: %v", err)
	}
	defer resultsIterator.Close()

	var results []IntegrityCheckResult
	validCount := 0
	corruptedCount := 0

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		currentHash := sha256.Sum256(queryResponse.Value)
		currentHashHex := hex.EncodeToString(currentHash[:])

		hashFromChain, err := ctx.GetStub().GetPrivateDataHash(collection, queryResponse.Key)
		if err != nil {
			continue
		}
		blockchainHashHex := hex.EncodeToString(hashFromChain)

		hashMatch := currentHashHex == blockchainHashHex

		result := IntegrityCheckResult{
			DocumentID:        queryResponse.Key,
			Collection:        collection,
			CurrentHashHex:    currentHashHex,
			BlockchainHashHex: blockchainHashHex,
			HashMatch:         hashMatch,
			DataIntact:        hashMatch,
			Warning:           "",
		}

		if !hashMatch {
			result.Warning = "CORRUPTED"
			corruptedCount++
		} else {
			validCount++
		}

		results = append(results, result)
	}

	summary := map[string]interface{}{
		"collection":      collection,
		"totalDocuments":  len(results),
		"validDocuments":  validCount,
		"corruptedDocs":   corruptedCount,
		"integrityStatus": corruptedCount == 0,
		"details":         results,
	}

	return summary, nil
}
