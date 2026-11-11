package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var (
	flagJSON                   bool
	flagProject                string
	flagExt                    string
	flagForceDrop              bool
	flagLocalPort              int
	flagSSHHost                string
	flagSSHUser                string
	flagDirectTunnel           bool
	flagDBRotateRole           string
	flagDBRotateTerminateConns bool
)

var dbCmd = &cobra.Command{
	Use:   "db",
	Short: "Manage databases and provisioning",
}

var dbListCmd = &cobra.Command{
	Use:     "ls",
	Aliases: []string{"list"},
	Short:   "List provisioned databases",
	RunE: func(cmd *cobra.Command, args []string) error {
		projects, err := apiCli.ListProjects()
		if err != nil {
			return err
		}

		if flagJSON {
			data, _ := json.MarshalIndent(projects, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "DATABASE\tSTATUS\tSIZE\tCONNS\tOWNER ROLE\tCREATED")
		for _, p := range projects {
			fmt.Fprintf(w, "%v\t%v\t%v\t%v\t%v\t%v\n",
				p["name"], p["status"], p["size"], p["conns"], p["owner"], p["created"])
		}
		return w.Flush()
	},
}

var dbCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Provision a new tenant database with isolated admin and read-only roles",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		var exts []string
		if flagExt != "" && flagExt != "none" {
			for _, e := range strings.Split(flagExt, ",") {
				if clean := strings.TrimSpace(e); clean != "" {
					exts = append(exts, clean)
				}
			}
		}

		fmt.Printf("Provisioning database '%s' (project: %s, extensions: %v)...\n", name, flagProject, exts)
		resp, err := apiCli.CreateProject(name, flagProject, exts)
		if err != nil {
			return fmt.Errorf("provisioning failed: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		proj, _ := resp["project"].(map[string]any)
		fmt.Println("\n✓ Database provisioned successfully!")
		fmt.Printf("Database:       %v\n", proj["db_name"])
		fmt.Printf("Owner Role:     %v\n", proj["admin_role"])
		fmt.Printf("Read-Only Role: %v\n", proj["readonly_role"])
		fmt.Printf("\nPgBouncer Pooler Admin Connection String (Recommended):\n  %v\n", resp["admin_pooler_connection_string"])
		fmt.Printf("PgBouncer Pooler Read-Only Connection String:\n  %v\n", resp["readonly_pooler_connection_string"])
		fmt.Printf("\nDirect Admin Connection String:\n  %v\n", resp["admin_connection_string"])
		fmt.Printf("Direct Read-Only Connection String:\n  %v\n", resp["readonly_connection_string"])

		return nil
	},
}

var dbGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get details for a provisioned database",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		p, err := apiCli.GetProject(id)
		if err != nil {
			return err
		}

		if flagJSON {
			data, _ := json.MarshalIndent(p, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Name:         %v\n", p["name"])
		fmt.Printf("Database:     %v\n", p["db_name"])
		fmt.Printf("Project:      %v\n", p["project"])
		fmt.Printf("Status:       %v\n", p["status"])
		fmt.Printf("Size:         %v\n", p["size"])
		fmt.Printf("Connections:  %v\n", p["conns"])
		fmt.Printf("Owner:        %v\n", p["owner"])
		fmt.Printf("Created:      %v\n", p["created"])
		fmt.Printf("\nPooler Admin URI (Recommended):\n  %v\n", p["admin_pooler_uri"])
		fmt.Printf("Pooler Read-only URI:\n  %v\n", p["readonly_pooler_uri"])
		fmt.Printf("\nDirect Admin URI:\n  %v\n", p["admin_uri"])
		fmt.Printf("Direct Read-only URI:\n  %v\n", p["readonly_uri"])
		return nil
	},
}

var dbConnectCmd = &cobra.Command{
	Use:     "connect <id>",
	Aliases: []string{"psql"},
	Short:   "Connect to a database using psql or display connection command",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		p, err := apiCli.GetProject(id)
		if err != nil {
			return err
		}

		uri, _ := p["admin_pooler_uri"].(string)
		if uri == "" {
			uri, _ = p["admin_uri"].(string)
		}

		fmt.Printf("Database: %v (%v)\n", p["name"], p["db_name"])
		fmt.Printf("Connection String:\n  %s\n\n", uri)

		psqlPath, err := exec.LookPath("psql")
		if err != nil {
			fmt.Println("Tip: Install 'psql' to connect interactively, or run:")
			fmt.Printf("  psql \"%s\"\n", uri)
			return nil
		}

		fmt.Println("Connecting with psql...")
		c := exec.Command(psqlPath, uri)
		c.Stdin = os.Stdin
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		return c.Run()
	},
}

var dbDropCmd = &cobra.Command{
	Use:     "rm <id>",
	Aliases: []string{"drop", "delete"},
	Short:   "Drop a database and its associated roles",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		if !flagForceDrop {
			fmt.Printf("Are you sure you want to drop database '%s' and all its data? Use --force to confirm.\n", id)
			return nil
		}

		fmt.Printf("Dropping database and roles for '%s'...\n", id)
		if err := apiCli.DeleteProject(id); err != nil {
			return err
		}

		fmt.Printf("✓ Database '%s' dropped successfully.\n", id)
		return nil
	},
}

var dbBranchCmd = &cobra.Command{
	Use:   "branch <source-id> <new-branch-name>",
	Short: "Clone an existing database and its schema/data into a new tenant branch",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		sourceID := args[0]
		branchName := args[1]

		fmt.Printf("Cloning database '%s' into new branch '%s'...\n", sourceID, branchName)
		resp, err := apiCli.BranchProject(sourceID, branchName)
		if err != nil {
			return fmt.Errorf("branching failed: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		proj, _ := resp["project"].(map[string]any)
		fmt.Println("\n✓ Branch created successfully!")
		fmt.Printf("Branch Database: %v\n", proj["db_name"])
		fmt.Printf("Owner Role:      %v\n", proj["admin_role"])
		fmt.Printf("Read-Only Role:  %v\n", proj["readonly_role"])
		fmt.Printf("\nPgBouncer Pooler Admin Connection String (Recommended):\n  %v\n", resp["admin_pooler_connection_string"])
		fmt.Printf("PgBouncer Pooler Read-Only Connection String:\n  %v\n", resp["readonly_pooler_connection_string"])
		fmt.Printf("\nDirect Admin Connection String:\n  %v\n", resp["admin_connection_string"])
		fmt.Printf("Direct Read-Only Connection String:\n  %v\n", resp["readonly_connection_string"])

		return nil
	},
}

var dbTunnelCmd = &cobra.Command{
	Use:   "tunnel <id>",
	Short: "Open an encrypted SSH tunnel to the PostgreSQL host for local GUI tools (TablePlus, DBeaver)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		p, err := apiCli.GetProject(id)
		if err != nil {
			return err
		}

		remotePort := 6432 // default PgBouncer
		targetDesc := "PgBouncer (port 6432)"
		if flagDirectTunnel {
			remotePort = 5434 // direct PostgreSQL
			targetDesc = "Direct PostgreSQL (port 5434)"
		}

		adminRole, _ := p["admin_role"].(string)
		adminPass, _ := p["admin_password"].(string)
		dbName, _ := p["db_name"].(string)

		localURI := fmt.Sprintf("postgresql://%s:%s@localhost:%d/%s?sslmode=disable",
			adminRole, adminPass, flagLocalPort, dbName)

		fmt.Printf("=== VPSQL Encrypted SSH Tunnel ===\n")
		fmt.Printf("Database:    %s\n", dbName)
		fmt.Printf("Target:      %s\n", targetDesc)
		fmt.Printf("Forward:     localhost:%d -> %s:%d\n\n", flagLocalPort, flagSSHHost, remotePort)
		fmt.Printf("Local Connection URI for DBeaver / TablePlus / psql:\n  %s\n\n", localURI)

		sshPath, err := exec.LookPath("ssh")
		if err != nil {
			fmt.Printf("SSH client not found in PATH. Run manually:\n  ssh -N -L %d:127.0.0.1:%d %s@%s\n",
				flagLocalPort, remotePort, flagSSHUser, flagSSHHost)
			return nil
		}

		fmt.Println("Establishing tunnel (press Ctrl+C to stop)...")
		sshArgs := []string{
			"-N",
			"-L", fmt.Sprintf("%d:127.0.0.1:%d", flagLocalPort, remotePort),
			fmt.Sprintf("%s@%s", flagSSHUser, flagSSHHost),
		}

		c := exec.Command(sshPath, sshArgs...)
		c.Stdin = os.Stdin
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		return c.Run()
	},
}

var dbRotateCmd = &cobra.Command{
	Use:   "rotate <name>",
	Short: "Rotate credentials for a database (admin, readonly, or all roles)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		role := flagDBRotateRole
		if role == "" {
			role = "all"
		}
		fmt.Printf("Rotating '%s' credentials for database '%s'...\n", role, id)

		res, err := apiCli.RotateDatabase(id, role, flagDBRotateTerminateConns)
		if err != nil {
			return fmt.Errorf("failed to rotate database credentials: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ Database credentials rotated successfully!")
		if total, ok := res["terminated_sessions"].(float64); ok && total > 0 {
			fmt.Printf("⚡ Terminated %d active sessions holding old credentials.\n", int(total))
		}
		if adminUri, ok := res["admin_pooler_connection_string"].(string); ok && adminUri != "" {
			fmt.Printf("Admin Pooler URI:    %s\n", adminUri)
		}
		if roUri, ok := res["readonly_pooler_connection_string"].(string); ok && roUri != "" {
			fmt.Printf("Read-only Pooler URI:%s\n", roUri)
		}
		return nil
	},
}

func init() {
	dbListCmd.Flags().BoolVar(&flagJSON, "json", false, "Output as JSON")

	dbCreateCmd.Flags().StringVar(&flagProject, "project", "default", "Project tag/group")
	dbCreateCmd.Flags().StringVar(&flagExt, "ext", "uuid-ossp,pgcrypto", "Comma-separated extensions to enable")
	dbCreateCmd.Flags().BoolVar(&flagJSON, "json", false, "Output response as JSON")

	dbBranchCmd.Flags().BoolVar(&flagJSON, "json", false, "Output response as JSON")

	dbTunnelCmd.Flags().IntVarP(&flagLocalPort, "port", "p", 5433, "Local port to bind")
	dbTunnelCmd.Flags().StringVar(&flagSSHHost, "host", "203.0.113.10", "SSH bastion/server host")
	dbTunnelCmd.Flags().StringVarP(&flagSSHUser, "user", "u", "eliasolie", "SSH username")
	dbTunnelCmd.Flags().BoolVar(&flagDirectTunnel, "direct", false, "Tunnel directly to Postgres (port 5434) instead of PgBouncer (6432)")

	dbGetCmd.Flags().BoolVar(&flagJSON, "json", false, "Output response as JSON")

	dbDropCmd.Flags().BoolVarP(&flagForceDrop, "force", "f", false, "Force database deletion without interactive confirmation")

	dbRotateCmd.Flags().StringVar(&flagDBRotateRole, "role", "all", "Role to rotate: admin, readonly, or all")
	dbRotateCmd.Flags().BoolVar(&flagDBRotateTerminateConns, "terminate-connections", true, "Terminate active connections for rotated roles")
	dbRotateCmd.Flags().BoolVar(&flagJSON, "json", false, "Output response as JSON")

	dbCmd.AddCommand(dbListCmd)
	dbCmd.AddCommand(dbCreateCmd)
	dbCmd.AddCommand(dbBranchCmd)
	dbCmd.AddCommand(dbTunnelCmd)
	dbCmd.AddCommand(dbGetCmd)
	dbCmd.AddCommand(dbConnectCmd)
	dbCmd.AddCommand(dbDropCmd)
	dbCmd.AddCommand(dbRotateCmd)
	rootCmd.AddCommand(dbCmd)
}
