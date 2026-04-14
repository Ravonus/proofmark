export type ContractTemplate = {
	id: string;
	name: string;
	category: string;
	description: string;
	content: (params: {
		partyNames: string[];
		effectiveDate: string;
		term: string;
	}) => string;
};

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
	{
		id: "mutual-nda",
		name: "Mutual NDA",
		category: "NDA",
		description: "Both parties share confidential info equally",
		content: ({ partyNames, effectiveDate, term }) => {
			const parties = partyNames
				.map((n, i) => `Party ${String.fromCharCode(65 + i)}: ${n}`)
				.join("\n");
			return `MUTUAL NON-DISCLOSURE AGREEMENT

Effective Date: ${effectiveDate}

PARTIES

${parties}

Each individually a "Party" and collectively the "Parties."

1. PURPOSE

The Parties wish to explore and/or engage in collaboration and may disclose Confidential Information to each other in connection with this purpose.

2. CONFIDENTIAL INFORMATION

"Confidential Information" means any non-public information disclosed by either Party, including but not limited to: source code, algorithms, technical specifications, business plans, financial models, customer data, trade secrets, and any information designated as confidential.

Confidential Information does NOT include information that: (a) is publicly available through no fault of the receiving Party; (b) was known prior to disclosure; (c) is independently developed; (d) is received from a third party without restriction.

3. OBLIGATIONS

Each Party agrees to:
(a) Hold Confidential Information in strict confidence
(b) Not disclose to any third party without prior written consent
(c) Use solely for the stated Purpose
(d) Protect with at least the same degree of care as their own confidential information
(e) Limit access to those with a need to know

4. CRYPTO-SPECIFIC PROVISIONS

(a) Neither Party shall disclose, share, or attempt to access private keys, seed phrases, or wallet credentials
(b) Publicly visible on-chain data is not Confidential; however, wallet-to-identity associations ARE Confidential
(c) Unpublished smart contract code is Confidential until deployed publicly
(d) Non-public token information shall not be used for personal trading advantage

5. TERM

This Agreement remains in effect for ${term} from the Effective Date. Confidentiality obligations survive termination for the same period.

6. REMEDIES

Breach may cause irreparable harm. The non-breaching Party is entitled to seek equitable relief including injunction.

7. GENERAL

This Agreement constitutes the entire agreement. Amendments require written consent. Digital/cryptographic wallet signatures constitute valid consent.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "one-way-nda",
		name: "One-Way NDA",
		category: "NDA",
		description: "One party discloses, others receive",
		content: ({ partyNames, effectiveDate, term }) => {
			const discloser = partyNames[0] || "Disclosing Party";
			const receivers = partyNames.slice(1);
			const receiverList =
				receivers.length > 0 ? receivers.join(", ") : "Receiving Party";
			return `ONE-WAY NON-DISCLOSURE AGREEMENT

Effective Date: ${effectiveDate}

PARTIES

Disclosing Party: ${discloser}
Receiving Party: ${receiverList}

1. PURPOSE

The Disclosing Party wishes to share certain Confidential Information with the Receiving Party for the purpose of evaluating a potential business relationship or collaboration.

2. CONFIDENTIAL INFORMATION

"Confidential Information" means any non-public information disclosed by the Disclosing Party, whether orally, in writing, electronically, or by any other means, including but not limited to: technical data, trade secrets, business plans, source code, financial information, and customer data.

3. OBLIGATIONS OF RECEIVING PARTY

The Receiving Party agrees to:
(a) Hold all Confidential Information in strict confidence
(b) Not disclose to any third party without prior written consent
(c) Use solely for evaluating the potential relationship
(d) Not reverse-engineer any provided materials
(e) Return or destroy all materials upon request

4. CRYPTO-SPECIFIC

(a) Private keys, seed phrases, and wallet credentials must never be disclosed
(b) Wallet-to-identity associations are Confidential
(c) Unpublished smart contract code is Confidential until public deployment

5. TERM

This Agreement remains in effect for ${term} from the Effective Date.

6. RETURN OF MATERIALS

Upon termination or request, the Receiving Party shall return or destroy all Confidential Information and confirm in writing.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "crypto-collaboration",
		name: "Crypto Project NDA",
		category: "NDA",
		description: "Tailored for Web3/crypto projects with token provisions",
		content: ({ partyNames, effectiveDate, term }) => {
			const parties = partyNames
				.map((n, i) => `Party ${String.fromCharCode(65 + i)}: ${n}`)
				.join("\n");
			return `CRYPTO PROJECT NON-DISCLOSURE AGREEMENT

Effective Date: ${effectiveDate}

PARTIES

${parties}

1. PURPOSE

The Parties are collaborating on or evaluating involvement in a cryptocurrency/blockchain project and may share sensitive technical and business information.

2. CONFIDENTIAL INFORMATION

Includes but is not limited to:
- Smart contract source code, audit reports, and deployment plans
- Tokenomics, distribution schedules, and vesting terms
- Protocol architecture, node infrastructure, and network topology
- MPC key management and treasury operations
- Listing plans, exchange negotiations, and market-making arrangements
- Governance mechanisms and voting systems
- Security vulnerabilities and incident reports
- Business strategy, partnerships, and roadmap

3. EXCLUSIONS

Does not include: publicly deployed smart contracts, on-chain transaction data, published whitepapers, or information independently developed.

4. WALLET & KEY SECURITY

(a) NO Party shall disclose or attempt to access another Party's private keys, seed phrases, mnemonic phrases, or key shares
(b) Accidental exposure must be reported immediately
(c) Multi-sig configurations and threshold schemes are Confidential
(d) MPC key share details and ceremony procedures are Confidential

5. TRADING RESTRICTIONS

No Party shall use non-public information regarding token launches, listings, pricing, distribution, or liquidity events for personal trading advantage. This constitutes a material breach.

6. IDENTITY PROTECTION

(a) The association between pseudonymous identities and wallet addresses is Confidential
(b) Real-world identity information, if shared, receives the highest level of protection
(c) Disclosure of identity information is grounds for immediate termination and legal action

7. TERM & SURVIVAL

Active for ${term}. Confidentiality obligations survive for the same period after termination. Trading restrictions survive indefinitely.

8. DISPUTE RESOLUTION

Disputes shall be resolved through binding arbitration conducted in English. The arbitrator's decision is final.

9. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment. Each Party's wallet address serves as their identifier.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "service-agreement",
		name: "Service Agreement",
		category: "Contract",
		description: "Define scope, compensation, and deliverables for services",
		content: ({ partyNames, effectiveDate, term }) => {
			const provider = partyNames[0] ?? "Service Provider";
			const client = partyNames[1] ?? "Client";
			return `SERVICE AGREEMENT

Effective Date: ${effectiveDate}

Service Provider: ${provider}
Client: ${client}

1. SERVICES

The Service Provider agrees to provide services as mutually agreed. Scope, deliverables, and timelines will be defined in Statements of Work (SOWs).

2. COMPENSATION

Compensation terms per SOW. Payment via fiat or cryptocurrency as agreed. Crypto payments are final upon blockchain confirmation.

3. INTELLECTUAL PROPERTY

Work product owned by Client upon full payment unless otherwise specified in SOW.

4. CONFIDENTIALITY

All non-public information is confidential. Private keys and wallet credentials are strictly confidential.

5. TERM & TERMINATION

Effective for ${term}. Either Party may terminate with 30 days written notice.

6. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "consulting-agreement",
		name: "Consulting Agreement",
		category: "Contract",
		description: "Independent contractor advisory and consulting engagement",
		content: ({ partyNames, effectiveDate, term }) => {
			const consultant = partyNames[0] ?? "Consultant";
			const company = partyNames[1] ?? "Company";
			return `CONSULTING AGREEMENT

Effective Date: ${effectiveDate}

Consultant: ${consultant}
Company: ${company}

1. ENGAGEMENT

The Company engages the Consultant as an independent contractor for advisory and consulting services.

2. SCOPE

Services may include: architecture review, code audits, tokenomics design, security assessments, strategy, and partnership introductions.

3. COMPENSATION

Rates as agreed in writing. Payment via transfer, crypto, or token allocation as mutually agreed.

4. INDEPENDENT CONTRACTOR

The Consultant is an independent contractor, not an employee.

5. CONFIDENTIALITY

All non-public information including source code, business plans, financial data, and private key material is strictly confidential.

6. TERM

${term} from the Effective Date. Renewable by mutual written agreement.

7. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "freelance-contract",
		name: "Freelance Contract",
		category: "Contract",
		description:
			"Project-based freelance work with milestones and payment terms",
		content: ({ partyNames, effectiveDate, term }) => {
			const freelancer = partyNames[0] ?? "Freelancer";
			const client = partyNames[1] ?? "Client";
			return `FREELANCE CONTRACT

Effective Date: ${effectiveDate}

Freelancer: ${freelancer}
Client: ${client}

1. PROJECT SCOPE

The Freelancer agrees to complete the project as defined in the attached or referenced project brief. Any changes to scope require written agreement.

2. MILESTONES & DELIVERABLES

Deliverables and milestones will be defined at project kickoff. Each milestone must be approved by the Client before proceeding.

3. PAYMENT

Total compensation as agreed. Payment schedule:
(a) ________________ upon signing
(b) ________________ upon milestone completion
(c) ________________ upon final delivery and approval

Payment accepted via bank transfer, cryptocurrency, or other agreed method. Crypto payments are final upon blockchain confirmation.

4. TIMELINE

Project duration: ${term} from the Effective Date. Extensions require mutual agreement.

5. INTELLECTUAL PROPERTY

All work product transfers to the Client upon full payment. Freelancer retains the right to use work in portfolio unless restricted.

6. REVISIONS

________________ rounds of revisions included. Additional revisions billed at the agreed hourly rate.

7. TERMINATION

Either Party may terminate with 14 days written notice. Payment due for completed work.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "lease-agreement",
		name: "Lease Agreement",
		category: "Real Estate",
		description: "Residential or commercial property lease with standard terms",
		content: ({ partyNames, effectiveDate, term }) => {
			const landlord = partyNames[0] ?? "Landlord";
			const tenant = partyNames[1] ?? "Tenant";
			return `LEASE AGREEMENT

Effective Date: ${effectiveDate}

Landlord: ${landlord}
Tenant: ${tenant}

1. PROPERTY

The Landlord agrees to lease the property located at:
Address: ________________

2. TERM

Lease term: ${term} beginning on ${effectiveDate}.

3. RENT

Monthly rent: ________________
Due on the ________________ of each month.
Late fee of ________________ applies after 5 days past due.

4. SECURITY DEPOSIT

Security deposit: ________________
Refundable within 30 days of lease termination, minus deductions for damages.

5. UTILITIES

Tenant is responsible for: ________________
Landlord is responsible for: ________________

6. MAINTENANCE

Tenant shall maintain the property in good condition. Landlord is responsible for structural repairs and major systems.

7. TERMINATION

Either Party may terminate with 30 days written notice before the lease term expires. Early termination may incur penalty of ________________.

8. GOVERNING LAW

This Agreement is governed by the laws of ________________.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "token-vesting",
		name: "Token Vesting Agreement",
		category: "Web3",
		description:
			"Token allocation with cliff, vesting schedule, and lockup terms",
		content: ({ partyNames, effectiveDate, term }) => {
			const project = partyNames[0] ?? "Project";
			const recipient = partyNames[1] ?? "Recipient";
			return `TOKEN VESTING AGREEMENT

Effective Date: ${effectiveDate}

Project / Issuer: ${project}
Recipient: ${recipient}

1. TOKEN GRANT

The Project grants the Recipient ________________ tokens ("Tokens") subject to the vesting schedule below.

2. VESTING SCHEDULE

Total allocation: ________________ tokens
Cliff period: ________________
Vesting duration: ${term}
Vesting frequency: Monthly / Quarterly (circle one)

Tokens vest linearly after the cliff period. Unvested tokens are forfeit upon termination.

3. WALLET

Tokens will be distributed to the Recipient's designated wallet:
Wallet Address: ________________
Chain: ________________

4. LOCKUP

Vested tokens are subject to a lockup period of ________________ after each vesting event. During lockup, tokens may not be transferred or sold.

5. TERMINATION

If the Recipient's engagement ends:
(a) Vested tokens remain the Recipient's property
(b) Unvested tokens are returned to the Project treasury
(c) Any lockup periods continue to apply

6. TRADING RESTRICTIONS

The Recipient shall not trade on material non-public information regarding the token or project.

7. TAX

The Recipient is solely responsible for all tax obligations arising from the token grant.

By signing, each Party agrees to be bound by these terms.`;
		},
	},
	{
		id: "partnership-agreement",
		name: "Partnership Agreement",
		category: "Contract",
		description:
			"Equal or custom partnership with profit sharing and governance",
		content: ({ partyNames, effectiveDate, term }) => {
			const parties = partyNames
				.map((n, i) => `Partner ${String.fromCharCode(65 + i)}: ${n}`)
				.join("\n");
			return `PARTNERSHIP AGREEMENT

Effective Date: ${effectiveDate}

PARTNERS

${parties}

1. PURPOSE

The Partners agree to form a partnership for the purpose of ________________.

2. CONTRIBUTIONS

Each Partner shall contribute as follows:
Partner A: ________________
Partner B: ________________

3. PROFIT & LOSS SHARING

Profits and losses shall be shared:
Partner A: ________________%
Partner B: ________________%

4. MANAGEMENT

(a) Major decisions require unanimous consent
(b) Day-to-day operations managed jointly unless delegated
(c) Each Partner has equal voting rights unless otherwise specified

5. TERM

Partnership term: ${term} from the Effective Date. Renewable by mutual agreement.

6. WITHDRAWAL & DISSOLUTION

(a) Any Partner may withdraw with 60 days written notice
(b) Remaining Partners may continue or dissolve
(c) Upon dissolution, assets are distributed per ownership percentages after debts

7. DISPUTE RESOLUTION

Disputes shall be resolved through mediation. If unresolved, binding arbitration applies.

8. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment.

By signing, each Partner agrees to be bound by these terms.`;
		},
	},
	{
		id: "employment-agreement",
		name: "Employment Agreement",
		category: "Employment",
		description:
			"Standard employment contract with compensation, duties, and termination terms",
		content: ({ partyNames, effectiveDate, term }) => {
			const employer = partyNames[0] || "Employer";
			const employee = partyNames[1] || "Employee";
			return `EMPLOYMENT AGREEMENT

Effective Date: ${effectiveDate}

PARTIES

Employer: ${employer}
Employee: ${employee}

1. POSITION AND DUTIES

The Employer hereby employs the Employee in the position of {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-0", type: "title", label: "Job Title", signerIdx: 1 }))}}} ("Position").

The Employee shall perform all duties reasonably assigned and shall report to their designated supervisor.

2. COMPENSATION

(a) Base Salary: The Employee shall receive an annual salary of {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-1", type: "free-text", label: "Annual Salary", signerIdx: 0 }))}}} payable in accordance with the Employer's standard payroll schedule.
(b) Benefits: The Employee shall be eligible for standard employee benefits including health insurance, retirement plan, and paid time off.

3. TERM

This Agreement shall commence on the Effective Date and continue for ${term}, unless earlier terminated.

4. CONFIDENTIALITY

The Employee agrees to maintain strict confidentiality of all proprietary information, trade secrets, client data, and business strategies.

5. NON-COMPETE

During employment and for twelve (12) months following termination, the Employee shall not engage in competing business activities within the relevant geographic market.

6. TERMINATION

Either party may terminate this Agreement:
(a) With thirty (30) days written notice
(b) Immediately for cause, including material breach, misconduct, or negligence
(c) By mutual written agreement

7. INTELLECTUAL PROPERTY

All work product, inventions, and intellectual property created during employment shall be the sole property of the Employer.

8. GOVERNING LAW

This Agreement shall be governed by the laws of the applicable jurisdiction.

DISCLOSING PARTY
Signature: _______________
Name: _______________
Title: _______________
Date: _______________

RECEIVING PARTY
Signature: _______________
Name: _______________
Date: _______________`;
		},
	},
	{
		id: "promissory-note",
		name: "Promissory Note",
		category: "Finance",
		description: "Simple loan agreement with repayment terms and interest",
		content: ({ partyNames, effectiveDate, term }) => {
			const lender = partyNames[0] || "Lender";
			const borrower = partyNames[1] || "Borrower";
			return `PROMISSORY NOTE

Date: ${effectiveDate}

PARTIES

Lender: ${lender}
Borrower: ${borrower}

1. PROMISE TO PAY

For value received, the Borrower promises to pay to the order of the Lender the principal sum of {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-0", type: "free-text", label: "Loan Amount", signerIdx: 0 }))}}} ("Principal Amount").

2. INTEREST

Interest shall accrue on the outstanding principal at a rate of {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-1", type: "free-text", label: "Interest Rate", signerIdx: 0 }))}}} per annum.

3. REPAYMENT

(a) The Principal Amount plus accrued interest shall be repaid within ${term} from the date of this Note
(b) Payments shall be made in monthly installments
(c) The Borrower may prepay without penalty

4. DEFAULT

The following constitute events of default:
(a) Failure to make any payment within ten (10) days of due date
(b) Borrower becomes insolvent or files for bankruptcy
(c) Material breach of any term of this Note

5. REMEDIES

Upon default, the entire unpaid balance plus accrued interest becomes immediately due and payable. The Lender may pursue all available legal remedies.

6. GOVERNING LAW

This Note shall be governed by the laws of the applicable jurisdiction.

DISCLOSING PARTY
Signature: _______________
Name: _______________
Date: _______________

RECEIVING PARTY
Signature: _______________
Name: _______________
Date: _______________`;
		},
	},
	{
		id: "licensing-agreement",
		name: "Software License Agreement",
		category: "Licensing",
		description: "Grant of software license rights with usage restrictions",
		content: ({ partyNames, effectiveDate, term }) => {
			const licensor = partyNames[0] || "Licensor";
			const licensee = partyNames[1] || "Licensee";
			return `SOFTWARE LICENSE AGREEMENT

Effective Date: ${effectiveDate}

PARTIES

Licensor: ${licensor}
Licensee: ${licensee}

1. GRANT OF LICENSE

The Licensor grants to the Licensee a non-exclusive, non-transferable license to use the Software identified as {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-0", type: "free-text", label: "Software Name", signerIdx: 0 }))}}} ("Software") for the duration of this Agreement.

2. LICENSE SCOPE

(a) The Licensee may install and use the Software on up to {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-1", type: "free-text", label: "Number of Seats", signerIdx: 0 }))}}} devices
(b) The Licensee shall not sublicense, sell, or distribute the Software
(c) The Licensee shall not reverse engineer, decompile, or disassemble the Software

3. LICENSE FEE

The Licensee shall pay a license fee as agreed between the parties.

4. TERM

This license is granted for ${term} from the Effective Date and may be renewed by mutual agreement.

5. INTELLECTUAL PROPERTY

All intellectual property rights in the Software remain with the Licensor. This Agreement does not transfer ownership.

6. WARRANTY DISCLAIMER

THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND.

7. LIMITATION OF LIABILITY

The Licensor's total liability shall not exceed the license fees paid.

8. TERMINATION

Either party may terminate with thirty (30) days written notice. Upon termination, the Licensee shall cease all use and destroy all copies.

DISCLOSING PARTY
Signature: _______________
Name: _______________
Date: _______________

RECEIVING PARTY
Signature: _______________
Name: _______________
Date: _______________`;
		},
	},
	{
		id: "non-compete-agreement",
		name: "Non-Compete Agreement",
		category: "Employment",
		description:
			"Restricts competitive activity during and after a business relationship",
		content: ({ partyNames, effectiveDate, term }) => {
			const company = partyNames[0] || "Company";
			const individual = partyNames[1] || "Individual";
			return `NON-COMPETE AGREEMENT

Effective Date: ${effectiveDate}

PARTIES

Company: ${company}
Individual: ${individual}

1. NON-COMPETE COVENANT

The Individual agrees that during the term of their relationship with the Company and for a period of ${term} thereafter, the Individual shall not:

(a) Engage in any business that competes with the Company
(b) Solicit or accept business from the Company's clients or customers
(c) Recruit or hire the Company's employees or contractors

2. GEOGRAPHIC SCOPE

This restriction applies within the geographic area where the Company conducts business.

3. CONSIDERATION

The Individual acknowledges receiving adequate consideration for this Agreement.

4. REASONABLENESS

Both parties agree that the restrictions herein are reasonable and necessary to protect the Company's legitimate business interests.

5. REMEDIES

Breach of this Agreement may cause irreparable harm. The Company shall be entitled to injunctive relief in addition to any other remedies available at law.

6. SEVERABILITY

If any provision is found unenforceable, it shall be modified to the minimum extent necessary to be enforceable.

DISCLOSING PARTY
Signature: _______________
Name: _______________
Title: _______________
Date: _______________

RECEIVING PARTY
Signature: _______________
Name: _______________
Date: _______________`;
		},
	},
	{
		id: "memorandum-of-understanding",
		name: "Memorandum of Understanding",
		category: "General",
		description:
			"Non-binding agreement outlining terms for future collaboration",
		content: ({ partyNames, effectiveDate, term }) => {
			const parties = partyNames
				.map((n, i) => `Party ${String.fromCharCode(65 + i)}: ${n}`)
				.join("\n");
			return `MEMORANDUM OF UNDERSTANDING

Effective Date: ${effectiveDate}

PARTIES

${parties}

1. PURPOSE

This Memorandum of Understanding ("MOU") outlines the terms and conditions under which the Parties intend to collaborate on {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-0", type: "free-text", label: "Project Description", signerIdx: 0 }))}}}.

2. SCOPE OF COLLABORATION

The Parties agree to:
(a) Share relevant information and resources
(b) Coordinate efforts toward the stated objectives
(c) Meet regularly to review progress

3. RESPONSIBILITIES

Each Party shall contribute as mutually agreed and shall act in good faith.

4. NON-BINDING NATURE

This MOU is a statement of intent and does not create legally binding obligations except for the confidentiality and dispute resolution provisions.

5. CONFIDENTIALITY

Information shared under this MOU shall be treated as confidential unless otherwise agreed.

6. DURATION

This MOU shall remain in effect for ${term} from the Effective Date unless extended or terminated by mutual agreement.

7. DISPUTE RESOLUTION

Any disputes arising shall be resolved through good faith negotiation, followed by mediation if necessary.

DISCLOSING PARTY
Signature: _______________
Name: _______________
Date: _______________

RECEIVING PARTY
Signature: _______________
Name: _______________
Date: _______________`;
		},
	},
	{
		id: "power-of-attorney",
		name: "Power of Attorney",
		category: "Legal",
		description: "Grants authority to act on behalf of another party",
		content: ({ partyNames, effectiveDate, term }) => {
			const principal = partyNames[0] || "Principal";
			const agent = partyNames[1] || "Agent";
			return `POWER OF ATTORNEY

Date: ${effectiveDate}

PARTIES

Principal: ${principal}
Agent (Attorney-in-Fact): ${agent}

1. GRANT OF AUTHORITY

The Principal hereby appoints the Agent as their true and lawful attorney-in-fact to act on their behalf in the following matters:

(a) Execute documents and agreements
(b) Manage financial accounts and transactions
(c) Make business decisions as specified herein
(d) Represent the Principal in negotiations

2. SCOPE OF AUTHORITY

This power of attorney is limited to: {{W3S_FIELD:${encodeURIComponent(JSON.stringify({ id: "field-0", type: "free-text", label: "Scope of Authority", signerIdx: 0 }))}}}

3. DURATION

This Power of Attorney shall remain in effect for ${term} from the date hereof unless earlier revoked.

4. REVOCATION

The Principal may revoke this Power of Attorney at any time by providing written notice to the Agent.

5. AGENT'S DUTIES

The Agent shall:
(a) Act in the best interest of the Principal
(b) Keep accurate records of all transactions
(c) Not commingle the Principal's assets with their own
(d) Not delegate authority without the Principal's consent

6. LIABILITY

The Agent shall not be liable for actions taken in good faith and within the scope of authority granted herein.

DISCLOSING PARTY
Signature: _______________
Name: _______________
Date: _______________

RECEIVING PARTY
Signature: _______________
Name: _______________
Date: _______________`;
		},
	},
	{
		id: "automation-review-test",
		name: "Automation Review Test Contract",
		category: "Testing",
		description:
			"Purpose-built to test admin-prep automation and human final-sign verification",
		content: ({ partyNames, effectiveDate }) => {
			const operator = partyNames[0] ?? "Contract Creator";
			const signer = partyNames[1] ?? "Signer";
			return `AUTOMATION REVIEW TEST AGREEMENT

Effective Date: ${effectiveDate}

Party A (Creator / Operator): ${operator}
Party B (Final Signer): ${signer}

1. PURPOSE

This agreement is used to test whether administrative preparation steps and critical signing steps can be distinguished during a digital signing session.

2. ADMINISTRATIVE PREPARATION

The Parties agree that low-risk preparation work may be completed by an assistant, operator, or approved automation system, including:
- pre-filling party names
- copying reference numbers
- pasting billing or mailing details
- navigating pages and sections

3. HUMAN-ONLY FINAL ACTIONS

The following actions must be completed directly by the final signer:
- reviewing the final form of the agreement
- confirming consent to sign
- applying the final signature
- submitting the completed agreement

4. DISCLOSURE OF AUTOMATION

If preparation work was performed by an agent or automation system, the Parties acknowledge that such activity may be flagged in the forensic record without invalidating the agreement unless the creator's policy requires denial.

5. TEST PROCEDURE

The Parties intend to use this agreement to exercise mixed behavior:
- Party A may prepare mundane fields or copy/paste reference text
- Party B should personally review and complete the final signature

6. NO TRANSFER OF VALUE

This test agreement does not itself transfer funds, equity, ownership, or legal rights beyond confirming participation in the test procedure.

7. DIGITAL EXECUTION

The Parties agree that digital signatures, typed consent, and associated forensic signing evidence may be used to validate whether the final signing action was completed by a human.

By signing, each Party confirms participation in this test workflow.`;
		},
	},
];
