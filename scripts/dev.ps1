<#
owner: M4 (D Venkata Abhishek)
purpose: Starts Pengu services in dependency order (store init, agent sidecar + MCP servers, desktop UI).
public interface: PowerShell script runnable from repo root on Windows 10/11.
consumed by: All team members and demo runner.
TODO: Implement ordered startup, env validation, and graceful teardown.
#>
