/**
 * Keeps the CMS and the site in step.
 *
 * public/admin/config.yml describes the fields a partner can edit; the pages
 * read those same keys out of src/content/*.yml through src/lib/content.ts. If
 * the two drift — a field renamed on one side only — the CMS quietly stops
 * offering some copy, or writes a key nothing reads. Neither breaks the build
 * on its own, so check it before every build.
 */
import fs from 'node:fs';
import yaml from 'js-yaml';

const root = process.cwd();
const config = yaml.load(fs.readFileSync(`${root}/public/admin/config.yml`, 'utf8'));
const problems = [];

function checkObject(where, fields, value) {
  const declared = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(value ?? {})) {
    if (!declared.has(key)) problems.push(`${where}: "${key}" in the file has no field in the CMS`);
  }
  for (const field of fields) {
    if (!(field.name in (value ?? {}))) problems.push(`${where}: CMS field "${field.name}" is missing from the file`);
    else checkField(`${where}.${field.name}`, field, value[field.name]);
  }
}

function checkField(where, field, value) {
  const widget = field.widget ?? 'string';
  if (widget === 'object') return checkObject(where, field.fields, value);
  if (widget === 'list') {
    if (!Array.isArray(value)) return problems.push(`${where}: expected a list, got ${typeof value}`);
    if (field.types) {
      const byName = new Map(field.types.map((t) => [t.name, t]));
      value.forEach((item, i) => {
        const type = byName.get(item?.type);
        if (!type) return problems.push(`${where}[${i}]: unknown block type "${item?.type}"`);
        const { type: _t, ...rest } = item;
        checkObject(`${where}[${i}](${item.type})`, type.fields, rest);
      });
    } else if (field.fields) {
      value.forEach((item, i) => checkObject(`${where}[${i}]`, field.fields, item));
    } else {
      value.forEach((item, i) => {
        if (typeof item !== 'string') problems.push(`${where}[${i}]: expected text, got ${typeof item}`);
      });
    }
    return;
  }
  if (widget === 'select' && field.options && !field.options.includes(value))
    problems.push(`${where}: "${value}" is not one of ${field.options.join(', ')}`);
  if (widget === 'boolean' && typeof value !== 'boolean')
    problems.push(`${where}: expected true/false, got ${typeof value}`);
  if ((widget === 'string' || widget === 'text') && typeof value !== 'string')
    problems.push(`${where}: expected text, got ${typeof value}`);
}

for (const single of config.singletons) {
  if (single.divider) continue;
  const value = yaml.load(fs.readFileSync(`${root}/${single.file}`, 'utf8'));
  checkObject(single.name, single.fields, value);
}

if (problems.length) {
  console.error('The CMS config and the content files disagree:\n');
  console.error(problems.map((p) => `  - ${p}`).join('\n'));
  console.error('\nFix public/admin/config.yml or the file it describes, then build again.');
  process.exit(1);
}
console.log('content ✓ every CMS field matches src/content/*.yml');
