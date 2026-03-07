import { parse, stringify } from 'yaml';
import { getComposeContent, saveComposeContent } from './docker.js';

export interface ResourceConfig {
  limits_cpus?: string;
  limits_memory?: string;
  reservations_cpus?: string;
  reservations_memory?: string;
  update_excluded?: boolean;
  update_check_excluded?: boolean;
}

type ComposeService = Record<string, any>;

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

function getService(doc: any, serviceName: string): ComposeService {
  const service = doc?.services?.[serviceName];
  if (!service || typeof service !== 'object') {
    throw new Error(`Service "${serviceName}" not found in compose file`);
  }

  return service;
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

function setUpdateExcludedLabel(service: ComposeService, excluded: boolean): void {
  const labels = service.labels;
  const key = 'dockwatch.update.exclude';

  if (Array.isArray(labels)) {
    const filtered = labels.filter((entry: unknown) => {
      return !(typeof entry === 'string' && entry.startsWith(`${key}=`));
    });
    if (excluded) filtered.push(`${key}=true`);
    if (filtered.length > 0) service.labels = filtered;
    else delete service.labels;
    return;
  }

  if (labels && typeof labels === 'object') {
    const mapLabels = labels as Record<string, unknown>;
    if (excluded) mapLabels[key] = 'true';
    else delete mapLabels[key];
    if (Object.keys(mapLabels).length === 0) delete service.labels;
    return;
  }

  if (excluded) {
    service.labels = { [key]: 'true' };
  } else {
    delete service.labels;
  }
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

function setUpdateCheckExcludedLabel(service: ComposeService, excluded: boolean): void {
  const labels = service.labels;
  const key = 'dockwatch.update.check.exclude';

  if (Array.isArray(labels)) {
    const filtered = labels.filter((entry: unknown) => {
      return !(typeof entry === 'string' && entry.startsWith(`${key}=`));
    });
    if (excluded) filtered.push(`${key}=true`);
    if (filtered.length > 0) service.labels = filtered;
    else delete service.labels;
    return;
  }

  if (labels && typeof labels === 'object') {
    const mapLabels = labels as Record<string, unknown>;
    if (excluded) mapLabels[key] = 'true';
    else delete mapLabels[key];
    if (Object.keys(mapLabels).length === 0) delete service.labels;
    return;
  }

  if (excluded) {
    service.labels = { [key]: 'true' };
  } else {
    delete service.labels;
  }
}

/** Get current resource config for a specific service in a stack */
export function getResourcesFromYaml(yamlContent: string, serviceName: string): ResourceConfig {
  const doc = parse(yamlContent);
  const service = doc?.services?.[serviceName] as ComposeService | undefined;
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

/** Update resources for a service, returns the new YAML content */
export function setResourcesInYaml(yamlContent: string, serviceName: string, config: ResourceConfig): string {
  const doc = parse(yamlContent);
  const service = getService(doc, serviceName);
  const normalized = normalizeConfig(config);

  // Update-exclusion is represented as compose label.
  setUpdateExcludedLabel(service, Boolean(normalized.update_excluded));
  setUpdateCheckExcludedLabel(service, Boolean(normalized.update_check_excluded));

  // Build the deploy.resources structure
  if (!service.deploy) service.deploy = {};
  if (!service.deploy.resources) service.deploy.resources = {};

  // Limits
  if (normalized.limits_cpus || normalized.limits_memory) {
    if (!service.deploy.resources.limits) service.deploy.resources.limits = {};
    if (normalized.limits_cpus) {
      service.deploy.resources.limits.cpus = normalized.limits_cpus;
      service.cpus = normalized.limits_cpus;
    } else {
      delete service.deploy.resources.limits.cpus;
      delete service.cpus;
    }
    if (normalized.limits_memory) {
      service.deploy.resources.limits.memory = normalized.limits_memory;
      service.mem_limit = normalized.limits_memory;
    } else {
      delete service.deploy.resources.limits.memory;
      delete service.mem_limit;
    }
  } else {
    delete service.deploy.resources.limits;
    delete service.cpus;
    delete service.mem_limit;
  }

  cleanupEmptyObject(service.deploy.resources, 'limits');

  // Reservations
  if (normalized.reservations_cpus || normalized.reservations_memory) {
    if (!service.deploy.resources.reservations) service.deploy.resources.reservations = {};
    if (normalized.reservations_cpus) {
      service.deploy.resources.reservations.cpus = normalized.reservations_cpus;
    } else {
      delete service.deploy.resources.reservations.cpus;
    }
    if (normalized.reservations_memory) {
      service.deploy.resources.reservations.memory = normalized.reservations_memory;
      service.mem_reservation = normalized.reservations_memory;
    } else {
      delete service.deploy.resources.reservations.memory;
      delete service.mem_reservation;
    }
  } else {
    delete service.deploy.resources.reservations;
    delete service.mem_reservation;
  }

  cleanupEmptyObject(service.deploy.resources, 'reservations');

  // Clean up empty objects
  cleanupEmptyObject(service.deploy, 'resources');
  cleanupEmptyObject(service, 'deploy');

  return stringify(doc, { lineWidth: 0 });
}

/** Get all services and their resource configs for a stack */
export async function getStackResources(stackName: string): Promise<Record<string, ResourceConfig>> {
  const content = await getComposeContent(stackName);
  const doc = parse(content);
  const result: Record<string, ResourceConfig> = {};

  if (doc?.services) {
    for (const svcName of Object.keys(doc.services)) {
      result[svcName] = getResourcesFromYaml(content, svcName);
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
  await saveComposeContent(stackName, newContent);
  return newContent;
}
