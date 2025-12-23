package chaincode

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) CreatePrivateLogDocument(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}

	logJson, ok := transMap["log"]
	if !ok {
		return fmt.Errorf("log key not found in transient map")
	}

	var inputLog PrivateLogDocument
	err = json.Unmarshal(logJson, &inputLog)
	if err != nil {
		return fmt.Errorf("failed to unmarshal private document JSON: %v", err)
	}

	// Create NEW struct with all fields (don't modify the unmarshaled one)
	log := PrivateLogDocument{
		CollectionLog: inputLog.CollectionLog,
		ID:            uuid.New().String(),
		DocumentID:    inputLog.DocumentID,
		ActorID:       inputLog.ActorID,
		ActorName:     inputLog.ActorName,
		Action:        inputLog.Action,
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}

	finalLogJson, err := json.Marshal(log)
	if err != nil {
		return fmt.Errorf("failed to marshal final log JSON: %v", err)
	}

	return ctx.GetStub().PutPrivateData(log.CollectionLog, log.ID, finalLogJson)
}

// func (s *SmartContract) CreatePrivateLogDocument(ctx contractapi.TransactionContextInterface) error {
// 	transMap, err := ctx.GetStub().GetTransient()
// 	if err != nil {
// 		return fmt.Errorf("failed to get transient: %v", err)
// 	}

// 	logJson, ok := transMap["log"]
// 	if !ok {
// 		return fmt.Errorf("log key not found in transient map")
// 	}

// 	var log PrivateLogDocument
// 	err = json.Unmarshal(logJson, &log)
// 	if err != nil {
// 		return fmt.Errorf("failed to unmarshal private document JSON: %v", err)
// 	}

// 	log.ID = uuid.New().String()
// 	log.Timestamp = time.Now().UTC().Format(time.RFC3339)

// 	finalLogJson, err := json.Marshal(log)
// 	if err != nil {
// 		return fmt.Errorf("failed to marshal final log JSON: %v", err)
// 	}
// 	return ctx.GetStub().PutPrivateData(log.CollectionLog, log.ID, finalLogJson)
// }

func (s *SmartContract) ReadAllLogByDocumentID(ctx contractapi.TransactionContextInterface, collectionLog string, documentID string) ([]*PrivateLogDocument, error) {
	query := fmt.Sprintf(`{"selector":{"documentID":"%s"}}`, documentID)

	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(collectionLog, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get log documents with id %s from %s: %v", documentID, collectionLog, err)
	}
	defer resultsIterator.Close()

	var logs []*PrivateLogDocument
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		// VALIDATE LOG HASH
		isValid, err := s.validateDataHash(ctx, collectionLog, queryResponse.Key, queryResponse.Value)
		if err != nil {
			fmt.Printf("Warning: Log hash validation error for %s: %v\n", queryResponse.Key, err)
		}
		if !isValid {
			fmt.Printf("CRITICAL ALERT: Audit log tampered! Log %s in %s has been corrupted\n", queryResponse.Key, collectionLog)
			// This is CRITICAL - audit logs should NEVER be corrupted
		}

		var log PrivateLogDocument
		err = json.Unmarshal(queryResponse.Value, &log)
		if err != nil {
			return nil, err
		}

		logs = append(logs, &log)
	}

	return logs, nil
}
