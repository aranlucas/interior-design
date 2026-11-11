/**
 * OpenAI strict structured output rejects any object whose `required` list omits a property.
 * Returns the JSON-schema paths of offending objects in a serialized request schema.
 */
export function nonStrictObjects(schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema))
    return schema.flatMap((item, i) => nonStrictObjects(item, `${path}[${i}]`));
  const node = schema as Record<string, unknown>;
  const problems: string[] = [];
  if (node.properties && typeof node.properties === "object") {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const missing = Object.keys(node.properties).filter((key) => !required.has(key));
    if (missing.length) problems.push(`${path} missing ${missing.join(", ")}`);
  }
  for (const [key, value] of Object.entries(node))
    problems.push(...nonStrictObjects(value, `${path}.${key}`));
  return problems;
}
