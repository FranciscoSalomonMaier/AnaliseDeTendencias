import { resourceUsageSchema } from './editing-resource.schema';
import { getResourceDefinition } from './editing-resource.registry';
import type {
  ResourceCapability,
  ValidatedResourceUsage,
} from './editing-resource.types';
export function validateResourceUsage(
  input: unknown,
  capabilities: readonly ResourceCapability[],
): ValidatedResourceUsage {
  const value = resourceUsageSchema.parse(input),
    definition = getResourceDefinition(value.resourceId);
  if (value.resourceVersion !== definition.version)
    throw Error('Versão de recurso não suportada.');
  if (
    !capabilities.some(
      (item) =>
        item.id === definition.id &&
        item.version === definition.version &&
        item.available,
    )
  )
    throw Error('Recurso de edição indisponível.');
  if (!definition.scopes.includes(value.target.scope))
    throw Error('Tipo de aplicação incompatível com o recurso.');
  if (!definition.parametersSchema)
    throw Error('Recurso sem contrato executável.');
  if (
    value.resourceId === 'CONCAT' &&
    (value.target.scope !== 'COMPOSITION' || !value.target.clipIds)
  )
    throw Error('CONCAT exige uma sequência ordenada de trechos.');
  if (
    definition.category === 'COMPOSITION' &&
    (value.target.scope !== 'COMPOSITION' || !value.target.clipId)
  )
    throw Error('A composição visual exige um trecho individual.');
  return {
    ...value,
    parameters: definition.parametersSchema.parse(value.parameters),
  } as ValidatedResourceUsage;
}
