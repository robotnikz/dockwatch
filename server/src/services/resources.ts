import { parse, parseDocument, isMap, isSeq, isScalar, type Document, type YAMLMap } from 'yaml';
import { getComposeContent, getEnvContent, saveComposeContent } from './docker.js';
import { snapshotStack } from './stackHistory.js';

export interface ResourceConfig {
  limits_cpus?: string;
  limits_memory?: string;
  reservations_cpus?: string;
  reservations_memory?: string;
  update_excluded?: boolean;
  update_check_excluded?: boolean;
}

type ComposeService = Record<string, any>;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isSafeKey(key: string): boolean {
  return !FORBIDDEN_KEYS.has(String(key));
}

function ensureSafeKey(key: string, context: string): void {
  if (!isSafeKey(key)) {
    throw new Error(`Invalid ${context}`);
  }
}

function hasOwn(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function createSafeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function sanitizeParsedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeParsedValue(entry));
  }

  if (value && typeof value === 'object') {
    const safe = createSafeRecord<unknown>();
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!isSafeKey(key)) continue;
      safe[key] = sanitizeParsedValue(child);
    }
    return safe;
  }

  return value;
}

function parseSafeYaml(yamlContent: string): Record<string, unknown> {
  const parsed = parse(yamlContent);
  const safe = sanitizeParsedValue(parsed);
  return (safe && typeof safe === 'object' ? safe : createSafeRecord<unknown>()) as Record<string, unknown>;
}

function normalizeValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function firstValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function cleanupEmptyObject(target: Record<string, unknown>, key: string): void {
  const value = target[key];
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    delete target[key];
  }
}

function getResourcesFromDoc(doc: any, serviceName: string): ResourceConfig {
  if (!isSafeKey(serviceName)) return {};
  const services = doc?.services;
  if (!services || typeof services !== 'object' || !hasOwn(services, serviceName)) return {};
  const service = (services as Record<string, unknown>)[serviceName] as ComposeService | undefined;
  if (!service || typeof service !== 'object') return {};

  const deploy = service.deploy || {};
  const resources = deploy.resources || {};
  const limits = resources.limits || {};
  const reservations = resources.reservations || {};

  return {
    limits_cpus: firstValue(limits.cpus, service.cpus),
    limits_memory: firstValue(limits.memory, service.mem_limit),
    reservations_cpus: firstValue(reservations.cpus),
    reservations_memory: firstValue(reservations.memory, service.mem_reservation),
    update_excluded: isUpdateExcluded(service.labels),
    update_check_excluded: isUpdateCheckExcluded(service.labels),
  };
}

function normalizeConfig(config: ResourceConfig): ResourceConfig {
  return {
    limits_cpus: normalizeValue(config.limits_cpus),
    limits_memory: normalizeValue(config.limits_memory),
    reservations_cpus: normalizeValue(config.reservations_cpus),
    reservations_memory: normalizeValue(config.reservations_memory),
    update_excluded: Boolean(config.update_excluded),
    update_check_excluded: Boolean(config.update_check_excluded),
  };
}

function isUpdateExcluded(labels: unknown): boolean {
  if (!labels) return false;
  if (Array.isArray(labels)) {
    return labels.some((entry) => {
      if (typeof entry !== 'string') return false;
      const [key, value] = entry.split('=');
      return key === 'dockwatch.update.exclude' && String(value).trim().toLowerCase() === 'true';
    });
  }
  if (typeof labels === 'object') {
    const value = (labels as Record<string, unknown>)['dockwatch.update.exclude'];
    return String(value).trim().toLowerCase() === 'true';
  }
  return false;
}

function isUpdateCheckExcluded(labels: unknown): boolean {
  if (!labels) return false;
  if (Array.isArray(labels)) {
    return labels.some((entry) => {
      if (typeof entry !== 'string') return false;
      const [key, value] = entry.split('=');
      return key === 'dockwatch.update.check.exclude' && String(value).trim().toLowerCase() === 'true';
    });
  }
  if (typeof labels === 'object') {
    const value = (labels as Record<string, unknown>)['dockwatch.update.check.exclude'];
    return String(value).trim().toLowerCase() === 'true';
  }
  return false;
}

/**
 * Add or remove a `key=true` label on a service node, keeping the label syntax (list or
 * map) and every other label untouched.
 */
function setBooleanLabel(doc: Document, service: YAMLMap, key: string, enabled: boolean): void {
  const labels = service.get('labels', true);

  if (isSeq(labels)) {
    labels.items = labels.items.filter((item) => {
      const value = isScalar(item) ? item.value : item;
      return !(typeof value === 'string' && value.trim().startsWith(`${key}=`));
    });
    if (enabled) labels.add(`${key}=true`);
    if (labels.items.length === 0) service.delete('labels');
    return;
  }

  if (isMap(labels)) {
    labels.delete(key);
    if (enabled) labels.set(key, 'true');
    if (labels.items.length === 0) service.delete('labels');
    return;
  }

  if (enabled) {
    service.set('labels', doc.createNode({ [key]: 'true' }));
  } else if (labels === null || isScalar(labels)) {
    service.delete('labels');
  }
}

function setOrDelete(doc: Document, path: string[], value: string | undefined): void {
  if (value) {
    doc.setIn(path, value);
  } else if (doc.hasIn(path)) {
    doc.deleteIn(path);
  }
}

function deleteIfEmptyMap(doc: Document, path: string[]): void {
  const node = doc.getIn(path, true);
  if (isMap(node) && node.items.length === 0) doc.deleteIn(path);
}

/** Get current resource config for a specific service in a stack */
export function getResourcesFromYaml(yamlContent: string, serviceName: string): ResourceConfig {
  const doc = parseSafeYaml(yamlContent);
  return getResourcesFromDoc(doc, serviceName);
}

/**
 * Update resources for a service, returns the new YAML content. Edits the YAML document
 * in place, so comments, ordering and formatting of untouched parts are preserved.
 */
export function setResourcesInYaml(yamlContent: string, serviceName: string, config: ResourceConfig): string {
  ensureSafeKey(serviceName, 'service name');
  const doc = parseDocument(yamlContent);
  if (doc.errors.length > 0) {
    throw new Error(`Invalid YAML: ${doc.errors[0].message}`);
  }

  const service = doc.getIn(['services', serviceName], true);
  if (!isMap(service)) {
    throw new Error(`Service "${serviceName}" not found in compose file`);
  }
  const normalized = normalizeConfig(config);
  const svc = ['services', serviceName];

  // Update-exclusion is represented as compose label.
  setBooleanLabel(doc, service, 'dockwatch.update.exclude', Boolean(normalized.update_excluded));
  setBooleanLabel(doc, service, 'dockwatch.update.check.exclude', Boolean(normalized.update_check_excluded));

  // Limits (deploy.resources plus the compatible service-level fields)
  setOrDelete(doc, [...svc, 'deploy', 'resources', 'limits', 'cpus'], normalized.limits_cpus);
  setOrDelete(doc, [...svc, 'cpus'], normalized.limits_cpus);
  setOrDelete(doc, [...svc, 'deploy', 'resources', 'limits', 'memory'], normalized.limits_memory);
  setOrDelete(doc, [...svc, 'mem_limit'], normalized.limits_memory);

  // Reservations
  setOrDelete(doc, [...svc, 'deploy', 'resources', 'reservations', 'cpus'], normalized.reservations_cpus);
  setOrDelete(doc, [...svc, 'deploy', 'resources', 'reservations', 'memory'], normalized.reservations_memory);
  setOrDelete(doc, [...svc, 'mem_reservation'], normalized.reservations_memory);

  // Clean up empty objects
  deleteIfEmptyMap(doc, [...svc, 'deploy', 'resources', 'limits']);
  deleteIfEmptyMap(doc, [...svc, 'deploy', 'resources', 'reservations']);
  deleteIfEmptyMap(doc, [...svc, 'deploy', 'resources']);
  deleteIfEmptyMap(doc, [...svc, 'deploy']);

  return doc.toString({ lineWidth: 0 });
}

/** Get all services and their resource configs for a stack */
export async function getStackResources(stackName: string): Promise<Record<string, ResourceConfig>> {
  const content = await getComposeContent(stackName);
  const doc = parseSafeYaml(content);
  const result: Record<string, ResourceConfig> = createSafeRecord<ResourceConfig>();

  if (doc?.services && typeof doc.services === 'object') {
    for (const svcName of Object.keys(doc.services)) {
      if (!isSafeKey(svcName)) continue;
      result[svcName] = getResourcesFromDoc(doc, svcName);
    }
  }
  return result;
}

/** Update resources for a service and save the compose file */
export async function updateServiceResources(
  stackName: string,
  serviceName: string,
  config: ResourceConfig
): Promise<string> {
  const content = await getComposeContent(stackName);
  const newContent = setResourcesInYaml(content, serviceName, config);
  if (newContent !== content) {
    try {
      await snapshotStack(stackName, { content, env: await getEnvContent(stackName) });
    } catch (err) {
      console.warn('[Resources] Could not save previous version of stack', stackName, err);
    }
  }
  await saveComposeContent(stackName, newContent);
  return newContent;
}
