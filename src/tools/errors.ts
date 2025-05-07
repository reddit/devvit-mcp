import semver from 'semver';

export class ToolError extends Error {
  public readonly toolName: string;

  constructor(message: string, toolName: string) {
    super(message);
    this.name = this.constructor.name;
    this.toolName = toolName;
  }
}

export class VersionNotFoundError extends ToolError {
  public readonly library: string;
  public readonly requestedVersion: string;
  public readonly availableVersions: Array<{
    version: string;
    indexed: boolean;
  }>;

  constructor(
    library: string,
    requestedVersion: string,
    availableVersions: Array<{
      version: string;
      indexed: boolean;
    }>
  ) {
    super(
      `Version ${requestedVersion} not found for ${library}. Available versions: ${availableVersions.map((v) => v.version).join(', ')}`,
      'SearchTool'
    );
    this.library = library;
    this.requestedVersion = requestedVersion;
    this.availableVersions = availableVersions;
  }

  getLatestVersion() {
    return this.availableVersions.sort((a, b) => semver.compare(b.version, a.version))[0];
  }
}
