package chaincode

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
	Timestamp     string `json:"timestamp,omitempty"`
}

type PrivateDocumentWebhook struct {
	Collection           string `json:"collection"`
	ID                   string `json:"documentID"`
	DocumentCategoryCode string `json:"documentCategoryCode"`
	Name                 string `json:"name"`
	Description          string `json:"description"`
	File                 string `json:"file"`
	Recipients           string `json:"recipients"`
	Timestamp            string `json:"timestamp,omitempty"`
}

type PrivateLogDocumentWebhook struct {
	CollectionLog     string `json:"collectionLog"`
	ID                string `json:"logID"`
	DocumentID        string `json:"documentID"`
	UserID            string `json:"userID"`
	Name              string `json:"name"`
	UserRoleCode      string `json:"userRoleCode"`
	RecipientRoleCode string `json:"recipientRoleCode"`
	Timestamp         string `json:"timestamp,omitempty"`
}

type IntegrityCheckResult struct {
	DocumentID        string `json:"documentID"`
	Collection        string `json:"collection"`
	CurrentHashHex    string `json:"currentHashHex"`
	BlockchainHashHex string `json:"blockchainHashHex"`
	HashMatch         bool   `json:"hashMatch"`
	DataIntact        bool   `json:"dataIntact"`
	Warning           string `json:"warning"`
}
