/* SPDX-License-Identifier: MIT */
var WDIM;

async function startup({ rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "src/core.js", globalThis);
  Services.scriptloader.loadSubScript(rootURI + "src/plugin.js", globalThis);
  WDIM = new WDIMPlugin(Zotero, rootURI);
  await WDIM.start();
}

function shutdown() {
  WDIM?.stop();
  WDIM = undefined;
}

function install() {}
function uninstall() {}
function onMainWindowLoad() { WDIM?.scan(); }
function onMainWindowUnload() {}
