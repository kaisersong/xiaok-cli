import { z } from 'zod';
import { PLUGIN_DEPENDENCY_STATUS_SCHEMA, PLUGIN_MCP_SERVER_SCHEMA } from './plugin-catalog-ipc-contract.js';
export const PLUGIN_ACTION_METHODS = ['installPlugin', 'installPluginDependency', 'updatePluginDependency', 'cancelPluginDependencyTask', 'diagnosePluginDependency', 'retryPluginComponent', 'openPluginDependencyPermissionSettings'] as const;
export type PluginActionMethod = typeof PLUGIN_ACTION_METHODS[number];
const identity = { pluginName: z.string(), dependencyId: z.string() };
const dependency = z.object({ ...identity, confirmed: z.boolean().optional() }).strict();
export const PLUGIN_ACTION_INPUTS = {
  installPlugin: z.tuple([z.string()]), installPluginDependency: z.tuple([dependency]), updatePluginDependency: z.tuple([dependency]),
  cancelPluginDependencyTask: z.tuple([z.object(identity).strict()]), diagnosePluginDependency: z.tuple([z.object(identity).strict()]),
  retryPluginComponent: z.tuple([z.object({ componentId: z.string() }).strict()]),
  openPluginDependencyPermissionSettings: z.tuple([z.object({ permission: z.enum(['screen', 'accessibility']) }).strict()]),
} as const;
const action = z.object({ success: z.boolean(), status: PLUGIN_DEPENDENCY_STATUS_SCHEMA.optional(), output: z.string().optional(), error: z.string().optional() }).passthrough();
export const PLUGIN_ACTION_OUTPUTS = {
  installPlugin: z.object({ success: z.boolean(), error: z.string().optional() }).passthrough(),
  installPluginDependency: action, updatePluginDependency: action, diagnosePluginDependency: action,
  cancelPluginDependencyTask: z.object({ cancelling: z.boolean() }).passthrough(),
  retryPluginComponent: z.array(PLUGIN_MCP_SERVER_SCHEMA), openPluginDependencyPermissionSettings: z.undefined(),
} as const;
export const PLUGIN_ACTION_RISKS = {
  installPlugin: ['external-process', 'network', 'fs-write'], installPluginDependency: ['external-process', 'network', 'fs-write'],
  updatePluginDependency: ['external-process', 'network', 'fs-write'], cancelPluginDependencyTask: ['internal-mutation'],
  diagnosePluginDependency: ['external-process'], retryPluginComponent: ['external-process', 'internal-mutation'],
  openPluginDependencyPermissionSettings: ['shell-open'],
} as const;
