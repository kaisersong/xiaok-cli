#!/usr/bin/env node
/**
 * after-pack.cjs — single electron-builder afterPack entry that runs every
 * packaging gate in order. Keeping one entry avoids silently dropping a gate
 * when a new one is added.
 */

const copyPackagedDependencies = require('./copy-packaged-dependencies.cjs');
const verifyPackagedMainFreshness = require('./verify-packaged-main-freshness.cjs');
const verifyPackagedRuntimeDependencies = require('./verify-packaged-runtime-dependencies.cjs');
const verifyPackagedContinuitySource = require('./verify-packaged-continuity-source.cjs');
const verifyPackagedYzjCli = require('./verify-packaged-yzj-cli.cjs');
const packNodeChild=require('./pack-node-child.cjs');
const pruneNodeChild=require('./prune-node-child.cjs');
const verifyPackagedNodeChildren=require('./verify-packaged-node-children.cjs');
const flipPackagedFuses=require('./flip-packaged-fuses.cjs');
const packBrokerRuntime = require('./pack-broker-runtime.cjs');
const packBundledRuntimes = require('./pack-bundled-runtimes.cjs');
const packArtifactExportHelper = require('./pack-artifact-export-helper.cjs');
const verifyPackagedServiceContracts = require('./verify-packaged-service-contracts.cjs');

module.exports = async function afterPack(context) {
  await copyPackagedDependencies(context);
  await verifyPackagedMainFreshness(context);
  await packBrokerRuntime(context);
  await packNodeChild(context);
  await verifyPackagedRuntimeDependencies(context);
  await pruneNodeChild(context);
  await verifyPackagedContinuitySource(context);
  await verifyPackagedYzjCli(context);
  await verifyPackagedNodeChildren(context);
  await packBundledRuntimes(context);
  // The service gate probes the Broker with the pinned packaged Node runtime
  // that production uses, so that runtime must be shipped before the probe.
  await verifyPackagedServiceContracts(context);
  await packArtifactExportHelper(context);
  await flipPackagedFuses(context);
};
