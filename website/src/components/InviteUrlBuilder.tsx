import React, { useState, useMemo } from 'react';
import Card from './Card';
import CodeBlock from './CodeBlock';

export function InviteUrlBuilder() {
  const [applicationId, setApplicationId] = useState('1403985306021269656');
  const [permissions, setPermissions] = useState('274877907968'); // Default permissions for Greatshield
  
  const inviteUrl = useMemo(() => {
    const baseUrl = 'https://discord.com/oauth2/authorize';
    const params = new URLSearchParams({
      client_id: applicationId,
      scope: 'bot applications.commands',
      permissions: permissions
    });
    return `${baseUrl}?${params.toString()}`;
  }, [applicationId, permissions]);

  const permissionsList = [
    { bit: '2048', name: 'Read Message History', enabled: true },
    { bit: '8192', name: 'Send Messages', enabled: true },
    { bit: '8192', name: 'Manage Messages', enabled: true },
    { bit: '268435456', name: 'Use Slash Commands', enabled: true },
    { bit: '268435456', name: 'Manage Roles (for shadowban)', enabled: true }
  ];

  return (
    <Card>
      <h3 className="text-lg font-semibold mb-4 uppercase tracking-wide">
        Discord Bot Invite Builder
      </h3>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-accent mb-2" htmlFor="app-id">
            Application ID:
          </label>
          <input
            id="app-id"
            type="text"
            value={applicationId}
            onChange={(e) => setApplicationId(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent font-mono text-sm"
            placeholder="Your Discord Application ID"
          />
        </div>
        
        <div>
          <label className="block text-sm text-accent mb-2" htmlFor="permissions">
            Permissions (integer):
          </label>
          <input
            id="permissions"
            type="text"
            value={permissions}
            onChange={(e) => setPermissions(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent font-mono text-sm"
            placeholder="Permission bits"
          />
        </div>
        
        <div>
          <div className="text-sm text-accent mb-2">Required Permissions:</div>
          <ul className="text-xs space-y-1 text-foreground/70">
            {permissionsList.map((perm, index) => (
              <li key={index}>• {perm.name}</li>
            ))}
          </ul>
        </div>
        
        <div>
          <div className="text-sm text-accent mb-2">Generated Invite URL:</div>
          <CodeBlock copyable={true}>
            {inviteUrl}
          </CodeBlock>
        </div>
      </div>
    </Card>
  );
}

export default InviteUrlBuilder;