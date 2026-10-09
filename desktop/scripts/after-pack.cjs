#!/usr/bin/env node
/**
 * after-pack.cjs — single electron-builder afterPack entry that runs every
 * packaging gate in order. Keeping one entry avoids silently dropping a gate
 * when a new one is added.
 */

const verifyPackagedMainFreshness = require('./verify-packaged-main-freshness.cjs');
const verifyPackagedRuntimeDependencies = require('./verify-packaged-runtime-dependencies.cjs');
const packBundledRuntimes = require('./pack-bundled-runtimes.cjs');
const verifyPackagedServiceContracts = require('./verify-packaged-service-contracts.cjs');

module.exports = async function afterPack(context) {
  await verifyPackagedMainFreshness(context);
  await verifyPackagedRuntimeDependencies(context);
  await verifyPackagedServiceContracts(context);
  await packBundledRuntimes(context);
};
