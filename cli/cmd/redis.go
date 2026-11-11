package cmd

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var (
	flagRedisJSON        bool
	flagRedisForceDrop   bool
	flagRedisPattern     string
	flagRedisTTL         int
	flagRedisLocalPort   int
	flagRedisSSHHost     string
	flagRedisSSHUser     string
)

var redisCmd = &cobra.Command{
	Use:   "redis",
	Short: "Manage Redis tenant caches, key-value namespaces, and ACL credentials",
}

var redisListCmd = &cobra.Command{
	Use:     "ls",
	Aliases: []string{"list"},
	Short:   "List provisioned Redis namespaces",
	RunE: func(cmd *cobra.Command, args []string) error {
		list, err := apiCli.ListRedis()
		if err != nil {
			return err
		}

		if flagRedisJSON {
			data, _ := json.MarshalIndent(list, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(list) == 0 {
			fmt.Println("No Redis namespaces found. Run 'vpsql redis create <name>' to provision one.")
			return nil
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "NAMESPACE\tUSER\tKEY PREFIX\tKEYS\tSTATUS\tCREATED")
		for _, r := range list {
			fmt.Fprintf(w, "%v\t%v\t%v\t%v\t%v\t%v\n",
				r["name"], r["username"], r["key_prefix"], r["key_count"], r["status"], r["created"])
		}
		return w.Flush()
	},
}

var redisCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Provision a new isolated Redis tenant using Redis 7+ ACLs",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		fmt.Printf("Provisioning Redis namespace '%s'...\n", name)
		resp, err := apiCli.CreateRedis(name)
		if err != nil {
			return fmt.Errorf("redis provisioning failed: %w", err)
		}

		if flagRedisJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		inst, _ := resp["instance"].(map[string]any)
		fmt.Println("\n✓ Redis namespace provisioned successfully!")
		fmt.Printf("Namespace:    %v\n", inst["name"])
		fmt.Printf("ACL User:     %v\n", inst["username"])
		fmt.Printf("Key Prefix:   %v\n", inst["key_prefix"])
		fmt.Printf("\nConnection String:\n  %v\n", resp["connection_string"])
		fmt.Printf("\nCLI Access Command:\n  %v\n", resp["cli_command"])
		fmt.Println("\nNode.js / ioredis example:")
		fmt.Printf("  const redis = new Redis(\"%v\", { keyPrefix: \"%v\" });\n", resp["connection_string"], inst["key_prefix"])

		return nil
	},
}

var redisGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get details for a provisioned Redis namespace",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		inst, err := apiCli.GetRedis(id)
		if err != nil {
			return err
		}

		if flagRedisJSON {
			data, _ := json.MarshalIndent(inst, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Namespace:    %v\n", inst["name"])
		fmt.Printf("ACL User:     %v\n", inst["username"])
		fmt.Printf("Key Prefix:   %v\n", inst["key_prefix"])
		fmt.Printf("Status:       %v\n", inst["status"])
		fmt.Printf("Total Keys:   %v\n", inst["key_count"])
		fmt.Printf("Created:      %v\n", inst["created"])
		fmt.Printf("\nConnection URI:\n  %v\n", inst["uri"])
		fmt.Printf("\nCLI Command:\n  %v\n", inst["cli_command"])
		return nil
	},
}

var redisKeysCmd = &cobra.Command{
	Use:   "keys <id>",
	Short: "List keys inside a Redis tenant namespace",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		keys, err := apiCli.ListRedisKeys(id, flagRedisPattern)
		if err != nil {
			return err
		}

		if flagRedisJSON {
			data, _ := json.MarshalIndent(keys, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(keys) == 0 {
			fmt.Println("No keys found matching pattern.")
			return nil
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "KEY\tTYPE\tTTL\tPREVIEW")
		for _, k := range keys {
			ttlStr := "no ttl"
			if ttl, ok := k["ttl"].(float64); ok && ttl >= 0 {
				ttlStr = fmt.Sprintf("%ds", int64(ttl))
			}
			valPreview := ""
			if v := k["value"]; v != nil {
				valPreview = fmt.Sprintf("%v", v)
			}
			fmt.Fprintf(w, "%v\t%v\t%v\t%v\n", k["clean_key"], k["type"], ttlStr, valPreview)
		}
		return w.Flush()
	},
}

var redisSetCmd = &cobra.Command{
	Use:   "set <id> <key> <value>",
	Short: "Set a string key under the tenant namespace",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		key := args[1]
		val := args[2]

		if err := apiCli.SetRedisKey(id, key, val, flagRedisTTL); err != nil {
			return err
		}

		fmt.Printf("✓ Key '%s' set successfully (TTL: %d seconds).\n", key, flagRedisTTL)
		return nil
	},
}

var redisDelCmd = &cobra.Command{
	Use:   "del <id> <key>",
	Short: "Delete a key under the tenant namespace",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		key := args[1]

		if err := apiCli.DeleteRedisKey(id, key); err != nil {
			return err
		}

		fmt.Printf("✓ Key '%s' deleted.\n", key)
		return nil
	},
}

var redisCliCmd = &cobra.Command{
	Use:   "cli <id>",
	Short: "Open an interactive redis-cli terminal connected to the Redis tenant",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		inst, err := apiCli.GetRedis(id)
		if err != nil {
			return err
		}

		uriStr, _ := inst["uri"].(string)
		u, err := url.Parse(uriStr)
		if err != nil {
			return fmt.Errorf("invalid connection URI: %w", err)
		}

		host := u.Hostname()
		port := u.Port()
		user := u.User.Username()
		pass, _ := u.User.Password()

		redisCliPath, err := exec.LookPath("redis-cli")
		if err != nil {
			fmt.Println("Tip: Install 'redis-cli' to connect interactively, or run:")
			fmt.Printf("  %s\n", inst["cli_command"])
			return nil
		}

		fmt.Printf("Connecting to Redis namespace '%s' (%s:%s as %s)...\n", inst["name"], host, port, user)
		argsList := []string{"-h", host, "-p", port, "--user", user, "-a", pass}
		c := exec.Command(redisCliPath, argsList...)
		c.Stdin = os.Stdin
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		return c.Run()
	},
}

var redisTunnelCmd = &cobra.Command{
	Use:   "tunnel <id>",
	Short: "Open an encrypted SSH tunnel to the VPSQL Redis host (port 6380)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		inst, err := apiCli.GetRedis(id)
		if err != nil {
			return err
		}

		remotePort := 6380 // VPSQL Redis port
		user, _ := inst["username"].(string)
		pass, _ := inst["password"].(string)

		localURI := fmt.Sprintf("redis://%s:%s@localhost:%d", user, pass, flagRedisLocalPort)

		fmt.Printf("=== VPSQL Redis Encrypted SSH Tunnel ===\n")
		fmt.Printf("Namespace:   %s\n", inst["name"])
		fmt.Printf("Target:      VPSQL Redis Container (port %d)\n", remotePort)
		fmt.Printf("Forward:     localhost:%d -> %s:%d\n\n", flagRedisLocalPort, flagRedisSSHHost, remotePort)
		fmt.Printf("Local Connection URI:\n  %s\n\n", localURI)

		sshPath, err := exec.LookPath("ssh")
		if err != nil {
			fmt.Printf("SSH client not found in PATH. Run manually:\n  ssh -N -L %d:127.0.0.1:%d %s@%s\n",
				flagRedisLocalPort, remotePort, flagRedisSSHUser, flagRedisSSHHost)
			return nil
		}

		fmt.Println("Establishing tunnel (press Ctrl+C to stop)...")
		sshArgs := []string{
			"-N",
			"-L", fmt.Sprintf("%d:127.0.0.1:%d", flagRedisLocalPort, remotePort),
			fmt.Sprintf("%s@%s", flagRedisSSHUser, flagRedisSSHHost),
		}

		c := exec.Command(sshPath, sshArgs...)
		c.Stdin = os.Stdin
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		return c.Run()
	},
}

var redisDropCmd = &cobra.Command{
	Use:     "rm <id>",
	Aliases: []string{"drop", "delete"},
	Short:   "Drop a Redis namespace and purge all its keys",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		if !flagRedisForceDrop {
			fmt.Printf("Are you sure you want to drop Redis namespace '%s' and purge all its keys? Use --force to confirm.\n", id)
			return nil
		}

		fmt.Printf("Dropping Redis namespace '%s'...\n", id)
		if err := apiCli.DeleteRedis(id); err != nil {
			return err
		}

		fmt.Printf("✓ Redis namespace '%s' dropped successfully.\n", id)
		return nil
	},
}

var redisRotateCmd = &cobra.Command{
	Use:   "rotate <id>",
	Short: "Rotate password for a Redis tenant namespace and disconnect active clients",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		fmt.Printf("Rotating credentials for Redis namespace '%s'...\n", id)

		res, err := apiCli.RotateRedis(id)
		if err != nil {
			return fmt.Errorf("failed to rotate redis credentials: %w", err)
		}

		if flagRedisJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ Redis credentials rotated and client connections reset successfully!")
		if connStr, ok := res["connection_string"].(string); ok {
			fmt.Printf("Connection URI: %s\n", connStr)
		}
		if cliCmd, ok := res["cli_command"].(string); ok {
			fmt.Printf("CLI Command:    %s\n", cliCmd)
		}
		return nil
	},
}

func init() {
	redisListCmd.Flags().BoolVar(&flagRedisJSON, "json", false, "Output as JSON")

	redisCreateCmd.Flags().BoolVar(&flagRedisJSON, "json", false, "Output as JSON")

	redisGetCmd.Flags().BoolVar(&flagRedisJSON, "json", false, "Output as JSON")

	redisKeysCmd.Flags().StringVarP(&flagRedisPattern, "pattern", "p", "", "Filter keys matching pattern")
	redisKeysCmd.Flags().BoolVar(&flagRedisJSON, "json", false, "Output as JSON")

	redisSetCmd.Flags().IntVar(&flagRedisTTL, "ttl", 0, "Time-to-live in seconds (0 = no expiration)")

	redisTunnelCmd.Flags().IntVarP(&flagRedisLocalPort, "port", "p", 6381, "Local port to bind")
	redisTunnelCmd.Flags().StringVar(&flagRedisSSHHost, "host", "203.0.113.10", "SSH bastion/server host")
	redisTunnelCmd.Flags().StringVarP(&flagRedisSSHUser, "user", "u", "eliasolie", "SSH username")

	redisDropCmd.Flags().BoolVarP(&flagRedisForceDrop, "force", "f", false, "Force deletion without confirmation")

	redisRotateCmd.Flags().BoolVar(&flagRedisJSON, "json", false, "Output as JSON")

	redisCmd.AddCommand(redisListCmd)
	redisCmd.AddCommand(redisCreateCmd)
	redisCmd.AddCommand(redisGetCmd)
	redisCmd.AddCommand(redisKeysCmd)
	redisCmd.AddCommand(redisSetCmd)
	redisCmd.AddCommand(redisDelCmd)
	redisCmd.AddCommand(redisCliCmd)
	redisCmd.AddCommand(redisTunnelCmd)
	redisCmd.AddCommand(redisDropCmd)
	redisCmd.AddCommand(redisRotateCmd)
	rootCmd.AddCommand(redisCmd)
}
