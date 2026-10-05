# Provision the platform owner

The platform console has no default owner and cannot be enabled from a merchant workspace.

After the intended operator has created and verified an active account, run this once in the controlled deployment environment:

```sh
PLATFORM_BOOTSTRAP_ADMIN_EMAIL="operator@example.com" npx tsx scripts/grant-platform-admin.ts
```

Use the same production database configuration that the application uses. The command only grants the `is_platform_admin` flag to an existing verified account. It does not create an account, expose a password, or configure a default email address.

Record the provisioning action in the deployment change log and keep access to the deployment terminal restricted.
