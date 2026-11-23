/**
 * owner: M4 (D Venkata Abhishek)
 * purpose: fs_create_folder ROUTINE tool creating folders inside approved roots only, idempotently.
 * public interface: fsCreateFolder(args), verifyFolderExists(path).
 * consumed by: mcp/local/src/server.ts (M4), M1 resume verifier.
 * TODO: Resolve real paths, reject traversal/symlink escape, return alreadyExisted flag.
 */
