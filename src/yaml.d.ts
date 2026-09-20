/** The CMS writes src/content/*.yml; @rollup/plugin-yaml turns them into modules. */
declare module '*.yml' {
  const data: unknown;
  export default data;
}
