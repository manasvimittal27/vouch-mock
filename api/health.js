// GET / and GET /health: always OK so AgenticOrg health checks pass.
export default function handler(req, res) {
  res.status(200).json({
    status: "ok",
    service: "vouch-delhivery-mock",
    mcp_endpoint: "/mcp",
    rest_endpoints: ["/c/api/pin-codes/json/?filter_codes=110017", "/api/dc/expected_tat?origin_pin=400001&destination_pin=110017"],
    time: new Date().toISOString()
  });
}
