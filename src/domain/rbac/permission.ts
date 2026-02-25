export class Permission {
  constructor(
    public readonly resource: string,
    public readonly action: string,
  ) {}

  static parse(value: string): Permission {
    const [resource, action] = value.split(":");
    if (!resource || !action) {
      throw new Error("Permission must be in resource:action format");
    }
    return new Permission(resource, action);
  }

  matches(required: Permission): boolean {
    return (
      this.resource === required.resource && this.action === required.action
    );
  }
}
