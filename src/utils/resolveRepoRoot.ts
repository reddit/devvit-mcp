export const resolveRepoRoot = (): string | undefined => {
  return (
    // If the user provides this, use it
    process.env.DEVVIT_WORKSPACE_ROOT ??
    // I have no idea if I need to split on the comma but given the name, I think so?
    // https://www.reddit.com/r/cursor/comments/1k796n6/cursor_mcp_working_directory/
    process.env.WORKSPACE_FOLDER_PATHS?.split(',')[0]
  );
};
