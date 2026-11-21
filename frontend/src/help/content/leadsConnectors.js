const p = (text) => ({ type: "paragraph", text });

export const leadsConnectorsDoc = {
  id: "leads-connectors",
  path: "/help/leads/connectors",
  title: "Connectors & Data Sources",
  summary: "Manage statutory registry pipelines, enrichment APIs, CRM integrations, and custom AI inference models powering your Leads workspace.",
  sections: [
    {
      id: "overview",
      heading: "Overview of Connectors",
      blocks: [
        p("The Connectors screen shows all the live backend data pipelines, statutory registries, verification endpoints, and AI models available to your workspace. It allows you to see active connections, verify credentials, monitor live latency, and connect your own internal systems."),
        p("Connectors are divided into two main partitions:"),
        {
          type: "table",
          headers: ["Partition", "Description", "Examples"],
          rows: [
            ["Data Connectors", "Statutory registries, postcode files, compliance engines, and CRM/data warehouse destinations.", "Companies House, Officers API, TPS Compliance, Ordnance Survey PAF, Salesforce, BigQuery."],
            ["Leads AI Connectors", "Specialized intelligence models and private inference servers handling fit scoring, copywriting, trade classification, and dossier synthesis.", "Outreach Lead Scoring AI, Cold Email Copywriter, Fast-SIC Classifier, Azure AI Studio, Private vLLM Server."],
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Account Visibility",
          text: "Connectors and active pipeline controls are specifically provisioned for designated enterprise and member partner accounts. In other accounts, enrichment operates automatically in the background.",
        },
      ],
    },
    {
      id: "statutory-registries",
      heading: "Statutory Registries & Enrichment Sources",
      blocks: [
        p("Every company identified or uploaded into Outreach is enriched against official UK statutory registries. These sources provide verifiable truth directly from government registers without scraping unreliable third-party lists."),
        {
          type: "table",
          headers: ["Registry / Source", "Update Frequency", "What It Enriches"],
          rows: [
            ["Companies House Live API", "Real-time query", "Statutory incorporation date, company status, registered office, official SIC codes, and annual accounts filing history."],
            ["Statutory Officers API", "On-demand query", "Active directors, company secretaries, resignation dates, nationalities, and roles."],
            ["TPS & CTPS Compliance", "Real-time screening", "28-day Telephone Preference Service compliance check protecting against statutory outbound calling fines."],
            ["Ordnance Survey PAF", "Bi-weekly sync", "Official UK Postcode Address File data, geographic easting/northing coordinates, local council districts, and territory bounds."],
            ["Food Standards Agency (FSA)", "Weekly sync", "Hygiene ratings, food premises inspections, and local authority hygiene compliance for hospitality venues."],
            ["Care Quality Commission (CQC)", "Weekly sync", "Healthcare provider registration status, inspection ratings, and care home management verification."],
            ["Web Crawler & Domain Engine", "On-demand execution", "Verified business domain, email MX records, public digital footprint, and active website confirmation."],
          ],
        },
      ],
    },
    {
      id: "ai-models-and-specialization",
      heading: "Leads AI Models & Specialization",
      blocks: [
        p("Behind the Leads search and journey drafting is a network of specialized neural models. Rather than relying on a single generic model for all tasks, Outreach distributes workload to targeted architectures designed for maximum accuracy and speed:"),
        {
          type: "steps",
          items: [
            "Outreach Lead Scoring AI: Evaluates official balance sheets, employee growth, and director continuity against your ideal customer criteria to assign ICP fit scores.",
            "Personalised Cold Email AI: Analyzes filed company activities, recent corporate milestones, and officer specializations to generate tailored 3-step outreach sequences.",
            "Company Dossier Synthesizer: Synthesizes statutory filings, balance sheet trends, website extracts, and director appointments into executive briefing notes.",
            "SIC Code & Trade Classifier AI: A fast 12-layer transformer model that maps natural language business descriptions directly to the official 2007 UK SIC code hierarchy.",
            "Semantic Search & Vector RAG: Dense embedding models that cluster companies by trade similarity and discover high-intent lookalike prospects.",
            "Director & Officer Ranker: Scores registered management personnel to surface the most relevant active commercial decision-makers.",
          ],
        },
      ],
    },
    {
      id: "editing-configurations",
      heading: "Customizing & Testing Connections",
      blocks: [
        p("You can customize both Data and AI connectors to match your organization's infrastructure. To edit an established connection:"),
        {
          type: "steps",
          items: [
            "Open the Connectors tab and click on any connector card.",
            "In the detail modal, click the 'Edit Configuration' button in the header or bottom banner.",
            "Update the Base Gateway URL or proxy endpoint to route requests through your internal network.",
            "Enter your custom API Key or Bearer Token. Use the visibility toggle to safely inspect entered secrets.",
            "Adjust inference parameters, including sampling temperature (0.0 to 1.0) and context window limits.",
            "Click 'Save Configuration'. The card will immediately reflect your custom settings and display a 'Customized' badge.",
            "Click 'Test API Connection' to send a diagnostic ping and verify HTTP 200 status and round-trip latency.",
          ],
        },
        {
          type: "callout",
          tone: "tip",
          title: "Factory Reset",
          text: "If you ever need to revert a customized connector back to system settings, click 'Edit Configuration' and select 'Reset to Defaults'.",
        },
      ],
    },
    {
      id: "bring-your-own-ai",
      heading: "Bring Your Own AI (Enterprise Gateways)",
      blocks: [
        p("Enterprise organizations with strict compliance, sovereign data residency, or private cloud commitments can connect dedicated cloud deployments:"),
        {
          type: "table",
          headers: ["Gateway", "Hosting Environment", "Key Benefits"],
          rows: [
            ["Microsoft Azure AI", "UK South / Sovereign Cloud", "Enterprise compliance, Entra ID authentication, zero external data egress."],
            ["Amazon Web Services Bedrock", "London (eu-west-2)", "VPC peering, private foundation model inference, IAM role credentials."],
            ["Google Cloud Vertex AI", "London (europe-west2)", "Deep multi-year filing analysis, large context context windows, service account auth."],
            ["Self-Hosted Private AI", "On-Premises / Internal LAN", "Zero internet egress, air-gapped private model servers, sub-15ms local latency."],
          ],
        },
      ],
    },
  ],
};
