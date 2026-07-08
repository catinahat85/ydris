// A stand-in MCP server for testing. Returns a deliberately fat, nested payload
// so you can prove projection trims it. Speaks stdio like a real MCP backend.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "fake-backend", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "record_search",
      description: "Search records and return selected fields.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async () => {
  // Fat payload: the kind of nested blob that overflows context.
  const bloated = {
    pagination: { page: 1, per_page: 25, total_entries: 4213, total_pages: 169 },
    breadcrumbs: [{ label: "Titles", signal_field_name: "record_titles", value: "vp" }],
    records: [
      {
        id: "5f3e2a1b9c8d7e6f",
        first_name: "Jordan",
        last_name: "Rivera",
        name: "Jordan Rivera",
        title: "VP of Engineering",
        email: "jordan.rivera@acme.io",
        email_status: "verified",
        headline: "VP Eng at Acme, building platform teams",
        photo_url: "https://static.example.com/avatars/5f3e2a1b.jpg",
        linkedin_url: "https://linkedin.com/in/jordanrivera",
        twitter_url: "https://twitter.com/jrivera",
        github_url: "https://github.com/jrivera",
        facebook_url: "https://facebook.com/jordan.rivera",
        extrapolated_email_confidence: 0.94,
        organization: {
          id: "org_889977",
          name: "Acme",
          website_url: "https://acme.io",
          blog_url: "https://acme.io/blog",
          angellist_url: null,
          linkedin_url: "https://linkedin.com/company/acme",
          founded_year: 2014,
          logo_url: "https://static.example.com/logos/acme.png",
          primary_industry: "software",
          estimated_num_employees: 620,
          raw_address: "500 Market St, San Francisco, CA 94105",
          phone: "+1-415-555-0100",
        },
        employment_history: [
          { organization_name: "PriorCo", title: "Staff Engineer", start_date: "2016-01", end_date: "2021-06" },
          { organization_name: "Acme", title: "VP of Engineering", start_date: "2021-07", end_date: null },
        ],
        functions: ["engineering"],
        seniority: "vp",
        departments: ["engineering_technical"],
      },
    ],
  };
  return {
    content: [{ type: "text", text: JSON.stringify(bloated) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[fake-backend] up");
