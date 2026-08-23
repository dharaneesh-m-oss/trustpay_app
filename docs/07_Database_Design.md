\## Projects



| Field | Type | Constraints | Description |

|--------|------|-------------|-------------|

| id | UUID | Primary Key | Unique project identifier |

| title | VARCHAR(150) | NOT NULL | Project title |

| description | TEXT | NOT NULL | Project description |

| created\_by | UUID | FK → Users(id) | Project creator (Client) |

| total\_amount | DECIMAL(12,2) | NOT NULL | Total agreed project value |

| currency | CHAR(3) | DEFAULT 'INR' | Currency code |

| status | ENUM | NOT NULL | Current project status |

| start\_date | DATE | NULL | Starts after escrow funding |

| end\_date | DATE | NOT NULL | Agreed completion date |

| created\_at | TIMESTAMP | NOT NULL | Creation timestamp |

| updated\_at | TIMESTAMP | NOT NULL | Last updated |



\### Status Enum



\- DRAFT

\- INVITED

\- AWAITING\_ACCEPTANCE

\- PLANNING

\- AWAITING\_ESCROW

\- ACTIVE

\- ON\_HOLD

\- UNDER\_DISPUTE

\- COMPLETED

\- CANCELLED



\### Business Rules



\- Only clients can create projects.

\- Sellers must accept invitations before work begins.

\- Milestones must be finalized before escrow funding.

\- The sum of milestone amounts must equal the project's total amount.

\- A project becomes ACTIVE only after full escrow funding.

\- Project title, description, and total amount become immutable once the seller accepts.

\- Milestones and end date can only be modified through mutual agreement.

## Wallets



| Field | Type | Constraints | Description |

|--------|------|-------------|-------------|

| id | UUID | Primary Key | Unique wallet identifier |

| user\_id | UUID | FK → Users(id), UNIQUE | Wallet owner |

| available\_balance | DECIMAL(12,2) | DEFAULT 0.00 | Withdrawable balance |

| locked\_balance | DECIMAL(12,2) | DEFAULT 0.00 | Temporarily locked funds |

| lifetime\_received | DECIMAL(12,2) | DEFAULT 0.00 | Total earnings received |

| currency | CHAR(3) | DEFAULT 'INR' | Wallet currency |

| created\_at | TIMESTAMP | NOT NULL | Creation timestamp |

| updated\_at | TIMESTAMP | NOT NULL | Last updated |



\### Business Rules



\- Every user has exactly one wallet.

\- Wallets are automatically created during user registration.

\- Wallets cannot be deleted.

\- Available balance can only increase after escrow releases funds.

\- Client payments go directly into escrow, not into the wallet.

\- Withdrawals are allowed only after successful KYC verification.

\- All balances default to 0.00.

## ProjectMembers



| Field | Type | Constraints | Description |

|--------|------|-------------|-------------|

| id | UUID | Primary Key | Unique membership identifier |

| project\_id | UUID | FK → Projects(id) | Associated project |

| user\_id | UUID | FK → Users(id) | Member of the project |

| role | ENUM | NOT NULL | CLIENT or SELLER |

| status | ENUM | DEFAULT 'PENDING' | Invitation status |

| invited\_by | UUID | FK → Users(id) | User who sent the invitation |

| joined\_at | TIMESTAMP | NULL | Acceptance timestamp |

| created\_at | TIMESTAMP | NOT NULL | Record creation timestamp |



\### Role Enum



\- CLIENT

\- SELLER



\### Status Enum



\- PENDING

\- ACCEPTED

\- REJECTED

\- REMOVED



\### Business Rules



\- Every project must have exactly one CLIENT.

\- A project can have one or more SELLERS.

\- A user cannot join the same project more than once.

\- Only ACCEPTED members can participate in project activities.

\- Only the CLIENT can invite SELLERS.

