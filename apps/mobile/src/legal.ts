export const LEGAL_VERSION = "2026-10-20";
export const LEGAL_STORAGE_KEY = "knoad.legal.v";
export const LEGAL_EFFECTIVE_DATE = "October 20, 2026";
export const LEGAL_TERMS_URL = "https://knoad.io/terms";
export const LEGAL_PRIVACY_URL = "https://knoad.io/privacy";

export type LegalChunk =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul"; items: string[] };

export type LegalDocument = {
  title: string;
  url: string;
  chunks: LegalChunk[];
};

export const TERMS_OF_SERVICE: LegalDocument = {
  title: "Terms of Service",
  url: LEGAL_TERMS_URL,
  chunks: [
    {
      type: "p",
      text: "By using knoad.io or KNOAD Wallet you agree to these terms. We do not run Discord or the blockchain, and we do not custody your wallet or hold the keys that spend it.",
    },
    {
      type: "p",
      text: "Virtual points, rewards, and digital perks are for utility and fun. They are not cash, not investment products, and not guaranteed to have value.",
    },
    { type: "h", text: "1. Acceptance of Terms" },
    {
      type: "p",
      text: 'By accessing or using knoad.io, the KNOAD Wallet phone application, or related services (together, the "Service"), you agree to be bound by these Terms of Service.',
    },
    { type: "p", text: "If you do not agree, do not use the Service." },
    { type: "h", text: "2. Who We Are" },
    {
      type: "p",
      text: 'knoad is operated by Cronosynthesis LLC ("Cronosynthesis", "we", "us", "our").',
    },
    {
      type: "p",
      text: "For contact options, see the footer on knoad.io or your account representative at Cronosynthesis LLC.",
    },
    { type: "h", text: "3. Description of Service" },
    { type: "p", text: "knoad provides tools and infrastructure for Discord-based communities, including:" },
    {
      type: "ul",
      items: [
        "Access control and verification systems",
        "Wallet-linked identity features",
        "Community analytics and dashboards",
        "Bot-driven functionality across Discord servers",
        "Qualification systems for entry, roles, and engagement",
        "KNOAD Wallet, non-custodial phone software that creates a smart account and signs transactions on supported networks",
      ],
    },
    { type: "p", text: "We do not control:" },
    { type: "ul", items: ["Discord platform behavior", "Blockchain networks", "Wallet providers"] },
    { type: "h", text: "4. Eligibility" },
    { type: "p", text: "You must:" },
    {
      type: "ul",
      items: [
        "Be at least 13 years old (or older if required in your jurisdiction)",
        "Have the legal capacity to agree to these Terms",
        "Comply with Discord's Terms of Service when you use Discord to access knoad.io",
      ],
    },
    {
      type: "p",
      text: "The age and capacity requirements apply to KNOAD Wallet whether or not you use knoad.io.",
    },
    { type: "h", text: "5. Accounts & Authentication" },
    { type: "p", text: "You access the Service via:" },
    {
      type: "ul",
      items: ["Discord authentication", "Optional wallet connection", "Optional third-party integrations (e.g. X/Twitter)"],
    },
    { type: "p", text: "You are responsible for:" },
    {
      type: "ul",
      items: ["Your account security", "Any activity under your account", "Maintaining control of your wallet"],
    },
    {
      type: "p",
      text: "Installing or using KNOAD Wallet does not create a knoad.io account and does not require Discord authentication.",
    },
    { type: "h", text: "6. Wallets & Blockchain" },
    { type: "p", text: "knoad and KNOAD Wallet are non-custodial." },
    {
      type: "p",
      text: "KNOAD Wallet is software published by Cronosynthesis LLC. It creates a smart account on the phone and signs transactions from that phone. It is not a bank, an exchange, a broker, or a custodian.",
    },
    { type: "p", text: "We:" },
    {
      type: "ul",
      items: [
        "Do not store private keys or the 24-word recovery phrase",
        "Do not custody digital assets",
        "Do not control your wallet",
        "Cannot freeze an account, replace a signer, recover a lost phrase, or reverse a transaction after it has been included on a network",
        "Do not initiate a transaction except through software on your phone after you confirm it",
      ],
    },
    {
      type: "p",
      text: "The 24-word recovery phrase and the spending keys remain on the phone. The phrase is displayed so that you can write it down. You must keep that written copy offline. If the phrase is lost, neither Cronosynthesis nor any other person can restore the account. You are responsible for the password that unlocks the phone vault and for any person who can use an unlocked phone.",
    },
    {
      type: "p",
      text: "KNOAD Wallet may be used on Ethereum and Base. Sepolia and Base Sepolia are available in the network switch for testing. You select the network. You pay the network fee for each send. The first send on a network deploys the account and retires that spending key. A transaction that is included is final on that network. A signature submitted by the application is your instruction to the network.",
    },
    { type: "p", text: "In the current version of KNOAD Wallet:" },
    {
      type: "ul",
      items: [
        "Swap and bridge quotes may be displayed. The application does not sign or submit them.",
        "The application does not offer a card purchase or sale.",
        "The application does not list or revoke token approvals or NFT permissions.",
        "The application does not import a wallet created in another product.",
      ],
    },
    { type: "p", text: "A network marked not ready is not available for use." },
    { type: "p", text: "You are solely responsible for:" },
    {
      type: "ul",
      items: [
        "Wallet security",
        "Transactions you confirm",
        "Network fees",
        "Network selection",
        "Third-party wallet, node, and bundler providers",
      ],
    },
    { type: "h", text: "7. Virtual Assets & Rewards" },
    { type: "p", text: "The platform may reference or utilize:" },
    { type: "ul", items: ["ARC (off-chain utility points)", "NFTs or digital assets", "Rewards, raffles, or incentives"] },
    { type: "p", text: "These are:" },
    {
      type: "ul",
      items: [
        "Not currency",
        "Not financial instruments",
        "Not guaranteed to have value",
        "Provided for entertainment and utility purposes only",
      ],
    },
    { type: "p", text: "We make no guarantees regarding:" },
    { type: "ul", items: ["Value", "Availability", "Continuity of rewards"] },
    { type: "h", text: "8. Third-Party Services" },
    { type: "p", text: "The Service relies on third parties including:" },
    {
      type: "ul",
      items: [
        "Discord",
        "Wallet providers",
        "Blockchain networks",
        "Hosting and infrastructure providers",
        "Remote procedure call (RPC) providers and transaction bundlers",
        "WalletConnect",
        "Price and quote services used by KNOAD Wallet when configured",
      ],
    },
    { type: "p", text: "We are not responsible for failures or actions of these services." },
    { type: "h", text: "9. Acceptable Use" },
    { type: "p", text: "You agree not to:" },
    {
      type: "ul",
      items: [
        "Abuse, exploit, or manipulate the system",
        "Circumvent eligibility or access controls",
        "Use bots or automation to gain unfair advantage",
        "Violate Discord's Terms of Service",
        "Engage in fraud, spam, or harmful behavior",
      ],
    },
    { type: "p", text: "We reserve the right to suspend or terminate access for violations." },
    { type: "h", text: "10. Intellectual Property" },
    { type: "p", text: "All platform content, branding, and systems are owned by Cronosynthesis LLC." },
    { type: "p", text: "You are granted a limited, non-transferable license to use the Service." },
    { type: "h", text: "11. Disclaimer of Warranties" },
    {
      type: "p",
      text: 'The Service is provided "as is" and "as available." We do not guarantee uptime, accuracy, reliability, or error-free operation.',
    },
    { type: "h", text: "12. Limitation of Liability" },
    { type: "p", text: "To the maximum extent permitted by law, Cronosynthesis is not liable for:" },
    {
      type: "ul",
      items: [
        "Loss of digital assets",
        "Missed rewards or opportunities",
        "Platform downtime",
        "Third-party failures",
        "Unauthorized access",
        "A lost or stolen recovery phrase or phone password",
        "A transaction you confirmed",
        "Network fees",
        "Failure or delay of a blockchain, bundler, price feed, or connected site",
      ],
    },
    { type: "h", text: "13. Termination" },
    { type: "p", text: "We may:" },
    { type: "ul", items: ["Suspend or terminate access at any time", "Remove features or functionality"] },
    { type: "p", text: "You may stop using the Service at any time." },
    { type: "h", text: "14. Changes to Terms" },
    {
      type: "p",
      text: "We may update these Terms. Continued use of knoad.io after an update means you accept the revised Terms. A material change is presented again in KNOAD Wallet. Continued use of KNOAD Wallet after you accept the revised Terms is acceptance of those Terms.",
    },
    { type: "h", text: "15. Governing Law" },
    {
      type: "p",
      text: "These Terms are governed by the laws of the State of North Carolina, without regard to conflict-of-law rules, except where prohibited by applicable law.",
    },
  ],
};

export const PRIVACY_POLICY: LegalDocument = {
  title: "Privacy Policy",
  url: LEGAL_PRIVACY_URL,
  chunks: [
    {
      type: "p",
      text: "We collect the minimum data needed to run knoad: mostly Discord account details, wallet addresses you link, optional X/Twitter if you connect it, and usage needed for security and analytics.",
    },
    {
      type: "p",
      text: "We do not sell personal data, do not publish individual analytics, and do not broker identity mappings to third parties for their marketing.",
    },
    {
      type: "p",
      text: "KNOAD Wallet keeps the recovery phrase and spending keys on the phone. We do not receive them. Wallet addresses and transactions are public on-chain once submitted.",
    },
    { type: "h", text: "1. Who We Are" },
    {
      type: "p",
      text: "Cronosynthesis LLC operates knoad and acts as the data controller for personal data described in this policy.",
    },
    {
      type: "p",
      text: "For contact options, see the Contact section in the knoad.io footer when available.",
    },
    { type: "h", text: "2. Information We Collect" },
    { type: "p", text: "We collect only what is necessary to operate the Service." },
    { type: "p", text: "Account & identity data" },
    {
      type: "ul",
      items: [
        "Discord user ID",
        "Username and profile info",
        "Email (if provided via Discord OAuth)",
        "Guild (server) membership data",
      ],
    },
    { type: "p", text: "Wallet data" },
    { type: "ul", items: ["Ethereum wallet addresses you link on knoad.io"] },
    { type: "p", text: "KNOAD Wallet" },
    {
      type: "p",
      text: "Cronosynthesis LLC does not receive the 24-word recovery phrase, the encrypted vault, the spending keys, or the phone password. Those remain on the device, together with the record that you accepted these Terms and this Privacy Policy. Uninstalling the application deletes that local copy. We do not keep a backup of it.",
    },
    { type: "p", text: "Social integrations" },
    { type: "ul", items: ["X (Twitter) username or ID (if linked)"] },
    { type: "p", text: "Usage & analytics data" },
    {
      type: "ul",
      items: ["Interaction with features", "Engagement metrics", "Activity related to dashboards and tools"],
    },
    { type: "p", text: "Technical data" },
    { type: "ul", items: ["Session identifiers (cookies or tokens)", "Basic logs for security and performance"] },
    { type: "h", text: "3. How We Use Data" },
    { type: "p", text: "We use data to:" },
    {
      type: "ul",
      items: [
        "Authenticate users",
        "Link identities (Discord and wallet)",
        "Enable platform features",
        "Determine eligibility (roles, access, requirements)",
        "Provide analytics and insights",
        "Maintain security and prevent abuse",
      ],
    },
    { type: "h", text: "4. What We Do Not Do" },
    {
      type: "ul",
      items: [
        "We do not sell personal data.",
        "We do not expose user-level analytics publicly.",
        "We do not link identities for external sale or distribution.",
        "We do not receive or store KNOAD Wallet recovery phrases or spending keys.",
      ],
    },
    { type: "h", text: "5. Data Sharing" },
    { type: "p", text: "We may share data with:" },
    {
      type: "ul",
      items: [
        "Discord (via OAuth)",
        "Wallet providers",
        "Hosting providers (e.g. VPS, cloud infrastructure)",
        "Database providers",
        "RPC providers and bundlers, which receive the account address and the transactions the phone submits",
        "WalletConnect, which receives a pairing when you connect a site",
        "CoinGecko, which receives a price request when a price key is configured",
        "A quote service, if one is configured, which receives the swap or bridge request. The current version of KNOAD Wallet does not sign that quote.",
      ],
    },
    { type: "p", text: "We may provide aggregated, anonymized analytics where appropriate." },
    { type: "p", text: "We do not share:" },
    {
      type: "ul",
      items: [
        "Individual identity mappings for unrelated third-party marketing",
        "Personal-level behavioral data for sale",
      ],
    },
    {
      type: "p",
      text: "Operational subprocessors, such as infrastructure vendors, may process data solely to provide the Service.",
    },
    { type: "h", text: "6. Blockchain Transparency" },
    { type: "p", text: "Wallet addresses are public by nature on many networks." },
    { type: "p", text: "knoad does not control blockchain visibility or public transaction data." },
    { type: "p", text: "Users are responsible for understanding public blockchain exposure." },
    {
      type: "p",
      text: "An address and a transaction become public on the network when KNOAD Wallet submits them. Cronosynthesis LLC does not control that publication.",
    },
    { type: "h", text: "7. Data Storage" },
    { type: "p", text: "Data is stored using secure databases (for example, MongoDB)." },
    { type: "p", text: "KNOAD Wallet recovery phrases, vaults, and spending keys are not stored on our servers." },
    { type: "p", text: "We implement reasonable safeguards, but no system is 100% secure." },
    { type: "h", text: "8. Data Retention" },
    { type: "p", text: "We retain data:" },
    {
      type: "ul",
      items: ["While accounts are active", "As necessary for service functionality, security, and legal obligations"],
    },
    { type: "p", text: "Users may request deletion by contacting us using the information above." },
    {
      type: "p",
      text: "We do not retain the recovery phrase, the vault, or the spending keys, because we do not receive them. The acceptance record remains on the phone until the application is deleted or you accept a later version of these documents. A provider that receives a transaction or a lookup keeps its own logs under its own policy.",
    },
    { type: "h", text: "9. Your Rights" },
    { type: "p", text: "Depending on your jurisdiction, you may:" },
    {
      type: "ul",
      items: [
        "Request access to your data",
        "Request deletion",
        "Request correction",
        "Withdraw consent (where applicable)",
      ],
    },
    { type: "p", text: "Contact us via the Contact link in the knoad.io footer when available." },
    { type: "h", text: "10. Cookies & Sessions" },
    { type: "p", text: "We use session cookies or tokens for authentication." },
    { type: "p", text: "We use minimal tracking necessary for functionality and security." },
    { type: "h", text: "11. Children" },
    {
      type: "p",
      text: "The Service is not intended for users under 13 years old (or older where required by applicable law).",
    },
    { type: "h", text: "12. Changes to Privacy Policy" },
    {
      type: "p",
      text: "We may update this policy. Continued use of knoad.io after an update means you accept the revised policy. A material change is presented again in KNOAD Wallet. Continued use of KNOAD Wallet after you accept the revised policy is acceptance of that policy.",
    },
  ],
};

export const LEGAL_DOCUMENTS = [TERMS_OF_SERVICE, PRIVACY_POLICY];

export function reachedEnd(layoutHeight: number, offsetY: number, contentHeight: number): boolean {
  if (layoutHeight <= 0 || contentHeight <= 0) return false;
  if (contentHeight <= layoutHeight + 1) return true;
  return layoutHeight + offsetY >= contentHeight - 24;
}
