package chaincode

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// SmartContract provides functions for managing an Asset
type SmartContract struct {
	contractapi.Contract
}

type PrivateDocument struct {
	Collection   string `json:"collection"`
	ID           string `json:"documentID"`
	DocumentName string `json:"documentName"`
	OwnerID      string `json:"ownerID"`
	OwnerName    string `json:"ownerName"`
	Status       string `json:"status"`
}

type PrivateLogDocument struct {
	CollectionLog string `json:"collectionLog"`
	ID            string `json:"logID"`
	DocumentID    string `json:"documentID"`
	ActorID       string `json:"actorID"`
	ActorName     string `json:"actorName"`
	Action        string `json:"action"`
	Timestamp     string `json:"timestamp"`
}

func (s *SmartContract) CreatePrivateDocument(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}

	docJson, ok := transMap["doc"]
	if !ok {
		return fmt.Errorf("doc key not found in transient map")
	}

	var document PrivateDocument
	err = json.Unmarshal(docJson, &document)
	if err != nil {
		return fmt.Errorf("failed to unmarshal private document JSON: %v", err)
	}

	existing, err := ctx.GetStub().GetPrivateData(document.Collection, document.ID)
	if err != nil {
		return fmt.Errorf("failed to read from collection: %v", err)
	}
	if existing != nil {
		return fmt.Errorf("the private document %s already exists in collection %s", document.ID, document.Collection)
	}

	finalDocJson, err := json.Marshal(document)
	if err != nil {
		return fmt.Errorf("failed to marshal final document JSON: %v", err)
	}

	err = ctx.GetStub().PutPrivateData(document.Collection, document.ID, finalDocJson)
	if err != nil {
		return fmt.Errorf("failed to put private document: %v", err)
	}

	collectionLog := document.Collection + "Log"

	log := PrivateLogDocument{
		CollectionLog: collectionLog,
		ID:            uuid.New().String(),
		DocumentID:    document.ID,
		ActorID:       document.OwnerID,
		ActorName:     document.OwnerName,
		Action:        "UPLOAD_DOCUMENT",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}

	logJson, err := json.Marshal(log)
	if err != nil {
		return fmt.Errorf("failed to marshal log JSON: %v", err)
	}

	return ctx.GetStub().PutPrivateData(collectionLog, log.ID, logJson)
}

func (s *SmartContract) CreatePrivateLogDocument(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}

	logJson, ok := transMap["log"]
	if !ok {
		return fmt.Errorf("log key not found in transient map")
	}

	var log PrivateLogDocument
	err = json.Unmarshal(logJson, &log)
	if err != nil {
		return fmt.Errorf("failed to unmarshal private document JSON: %v", err)
	}

	log.ID = uuid.New().String()
	log.Timestamp = time.Now().UTC().Format(time.RFC3339)

	finalLogJson, err := json.Marshal(log)
	if err != nil {
		return fmt.Errorf("failed to marshal final log JSON: %v", err)
	}
	return ctx.GetStub().PutPrivateData(log.CollectionLog, log.ID, finalLogJson)
}

func (s *SmartContract) ReadAllDocumentByOrg(ctx contractapi.TransactionContextInterface, collection string) ([]*PrivateDocument, error) {
	resultsIterator, err := ctx.GetStub().GetPrivateDataByRange(collection, "", "")
	if err != nil {
		return nil, fmt.Errorf("failed to get documents from %s: %v", collection, err)
	}
	defer resultsIterator.Close()

	var documents []*PrivateDocument
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var document PrivateDocument
		err = json.Unmarshal(queryResponse.Value, &document)
		if err != nil {
			return nil, err
		}

		documents = append(documents, &document)
	}
	return documents, nil
}

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

		var log PrivateLogDocument
		err = json.Unmarshal(queryResponse.Value, &log)
		if err != nil {
			return nil, err
		}

		logs = append(logs, &log)
	}

	return logs, nil
}
