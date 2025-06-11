const path = require('path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
// We need child_process to run shell commands
const { execSync } = require('child_process');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: path.join(__dirname, 'icon.ico'),
    name: "Photopea",
    productName: "Photopea",
    executableName: 'photopea-desktop',
    ignore: [
      '^/out$',
      '^/node_modules/\\.bin',
      '(^|/)\\.'
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        authors: 'Photopea',
        description: 'A desktop wrapper for Photopea.',
        name: 'photopea-desktop',
        setupIcon: path.join(__dirname, 'icon.ico')
      },
    },
    // We only want a .zip for Darwin (macOS) now
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  // --- THIS IS THE NEW SECTION ---
  hooks: {
    postPackage: async (forgeConfig, packageResult) => {
      // This hook only runs for the Linux build
      if (packageResult.platform !== 'linux') {
        return;
      }

      console.log('Creating custom tar.gz for Linux...');
      const packagePath = packageResult.outputPaths[0];
      const outDir = path.dirname(packagePath); // e.g., 'out'
      const appName = path.basename(packagePath); // e.g., 'Photopea-linux-x64'
      const tarballName = `${appName}.tar.gz`;
      const tarballPath = path.join(outDir, 'make', tarballName);

      // Ensure the 'make' directory exists
      execSync(`mkdir -p ${path.join(outDir, 'make')}`);

      // Use the 'tar' command to create a gzipped archive.
      // -C changes the directory so the archive doesn't contain the full path.
      // This is the gold standard for creating a tarball.
      const command = `tar -czf "${tarballPath}" -C "${outDir}" "${appName}"`;
      
      console.log(`Executing: ${command}`);
      execSync(command);
      console.log(`Successfully created Linux tarball at: ${tarballPath}`);
    }
  },
  // --- END OF NEW SECTION ---
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};