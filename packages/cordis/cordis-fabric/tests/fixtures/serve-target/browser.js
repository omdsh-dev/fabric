// Serve-target fixture for serveBrowserTransform: a browser bundle shaped
// like the built-in bash toolview sample, so the neutralization selector
// exercises the same rewrite the ui-bash plugin performs on the real
// ui-conversation bundle. The apply() rewrite must emit a bridge call, so
// the served bytes carry the fabric bridge marker and the sample never
// registers its keyed slot. A second sample lets the multi-patch cases
// stack two rewrites on the same file.
const bashToolviewSample = {
  apply() {
    return { key: 'bash' }
  },
}

const planToolviewSample = {
  apply() {
    return { key: 'plan' }
  },
}

export default bashToolviewSample
