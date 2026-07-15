const literalMcpCredentialGuard = /(?:\b(?:http_headers|bearer_token|env)\s*(?:[.:=])|\burl\.(?:userinfo|query)(?:\.|\b)|https?:\/\/[^/\s:@]+:[^/\s@]+@|https?:\/\/[^\s?#]+\?(?:[^#\s]*&)?(?:[^&#=]*(?:token|secret|password|credential)|(?:(?:api|private|access)[_-]?)?key)=)/i

module.exports = { literalMcpCredentialGuard }
