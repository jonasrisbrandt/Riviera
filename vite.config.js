export default ({ command, isPreview }) => ({
  // GitHub project Pages serves the build under the repository name.
  // Keep the existing local development URL at localhost:5173/.
  base: command === 'build' || isPreview ? '/Riviera/' : '/',
});
