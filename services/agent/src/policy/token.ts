// owner: M1
// purpose: HMAC approval token issue/verify
// public interface it must expose: HMAC-SHA256 over canonicalJSON({approvalId, tool, argsHash, expiresAt}) with PENGU_APPROVAL_SECRET
// consumed by: approval-gate; M3/M4 servers verify independently
// TODO: implement (canonical scaffold placeholder — header only, no code, section 8)
