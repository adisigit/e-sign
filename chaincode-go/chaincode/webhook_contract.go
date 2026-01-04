package chaincode

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) CreatePrivateLogDocumentWebhook(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}
	logJson, ok := transMap["log"]
	if !ok {
		return fmt.Errorf("log key not found in transient map")
	}

	var log PrivateLogDocumentWebhook
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

	// DEBUG: Print what's being stored
	fmt.Printf("=== STORING LOG %s ===\n", log.ID)
	fmt.Printf("Data: %s\n", string(finalLogJson))
	calculatedHash := sha256.Sum256(finalLogJson)
	fmt.Printf("Hash: %s\n", hex.EncodeToString(calculatedHash[:]))
	fmt.Printf("=====================\n")

	return ctx.GetStub().PutPrivateData(log.CollectionLog, log.ID, finalLogJson)
}

func (s *SmartContract) CreatePrivateDataWebhook(ctx contractapi.TransactionContextInterface) error {
	transMap, err := ctx.GetStub().GetTransient()
	if err != nil {
		return fmt.Errorf("failed to get transient: %v", err)
	}
	webhookJSON, ok := transMap["webhook"]
	if !ok {
		return fmt.Errorf("webhook key not found in transient map")
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(webhookJSON, &payload); err != nil {
		return fmt.Errorf("failed to unmarshal webhook json: %v", err)
	}

	documentWebhook := PrivateDocumentWebhook{
		Collection:           payload["collection"].(string),
		ID:                   payload["id"].(string),
		DocumentCategoryCode: payload["documentCategoryCode"].(string),
		Name:                 payload["name"].(string),
		Description:          payload["description"].(string),
		File:                 payload["file"].(string),
		Timestamp:            time.Now().UTC().Format(time.RFC3339),
	}
	finalDocumentWebhookJson, err := json.Marshal(documentWebhook)
	if err != nil {
		return fmt.Errorf("failed to marshal final document webhook JSON: %v", err)
	}
	err = ctx.GetStub().PutPrivateData(documentWebhook.Collection, documentWebhook.ID, finalDocumentWebhookJson)
	if err != nil {
		return fmt.Errorf("failed to put private document webhook: %v", err)
	}

	collectionLog := documentWebhook.Collection + "Log"

	recipients := payload["recipients"].([]interface{})
	for _, recipient := range recipients {
		recipientMap := recipient.(map[string]interface{})
		logDocumentWebhook := PrivateLogDocumentWebhook{
			CollectionLog:     collectionLog,
			ID:                uuid.New().String(),
			DocumentID:        documentWebhook.ID,
			UserID:            recipientMap["userId"].(string),
			Name:              recipientMap["name"].(string),
			UserRoleCode:      recipientMap["userRoleCode"].(string),
			RecipientRoleCode: recipientMap["recipientRoleCode"].(string),
			Timestamp:         time.Now().UTC().Format(time.RFC3339),
		}

		logDocumentWebhookJson, err := json.Marshal(logDocumentWebhook)
		if err != nil {
			return fmt.Errorf("failed to marshal final log document webhook JSON: %v", err)
		}
		err = ctx.GetStub().PutPrivateData(collectionLog, logDocumentWebhook.ID, logDocumentWebhookJson)
		if err != nil {
			return fmt.Errorf("failed to put private log document webhook: %v", err)
		}
	}

	return nil
}

func (s *SmartContract) ReadAllLogByDocumentIDWebhook(ctx contractapi.TransactionContextInterface, collectionLog string, documentID string) ([]*PrivateLogDocumentWebhook, error) {
	query := fmt.Sprintf(`{"selector":{"documentID":"%s"}}`, documentID)

	resultsIterator, err := ctx.GetStub().GetPrivateDataQueryResult(collectionLog, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get log documents with id %s from %s: %v", documentID, collectionLog, err)
	}
	defer resultsIterator.Close()

	if !resultsIterator.HasNext() {
		return nil, fmt.Errorf("log document not found: %s", documentID)
	}

	var logs []*PrivateLogDocumentWebhook
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

		logs = append(logs, &log)
	}

	return logs, nil
}
