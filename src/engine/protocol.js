// Every platform build shares one server, so they all have to speak the same version
// Bump this when a change would break older builds, then redeploy the server and every build
export const PROTOCOL_VERSION = 1;
