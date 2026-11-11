package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var (
	flagRoleDB             string
	flagRoleReadOnly       bool
	flagRoleJSON           bool
	flagRoleTerminateConns bool
)

var roleCmd = &cobra.Command{
	Use:   "role",
	Short: "Manage database roles and permissions",
}

var roleListCmd = &cobra.Command{
	Use:   "ls",
	Short: "List roles and permissions across databases",
	RunE: func(cmd *cobra.Command, args []string) error {
		roles, err := apiCli.ListRoles()
		if err != nil {
			return err
		}

		if flagRoleJSON {
			data, _ := json.MarshalIndent(roles, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "ROLE\tKIND\tDATABASE\tGRANTS\tROTATED")
		for _, r := range roles {
			dbName := fmt.Sprint(r["db"])
			if flagRoleDB != "" && dbName != flagRoleDB {
				continue
			}
			fmt.Fprintf(w, "%v\t%v\t%v\t%v\t%v\n",
				r["name"], r["kind"], r["db"], r["grants"], r["rotated"])
		}
		return w.Flush()
	},
}

var roleCreateCmd = &cobra.Command{
	Use:   "create <role_name>",
	Short: "Create an additional role for a database",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		roleName := args[0]
		if flagRoleDB == "" {
			return fmt.Errorf("--db flag is required")
		}

		kind := "read-write"
		if flagRoleReadOnly {
			kind = "read-only"
		}

		fmt.Printf("Creating %s role '%s' for database '%s'...\n", kind, roleName, flagRoleDB)

		// Execute role creation via proxy query
		pwd := "vpsql_" + roleName + "_key"
		var createSQL string
		if flagRoleReadOnly {
			createSQL = fmt.Sprintf("CREATE ROLE \"%s\" WITH LOGIN PASSWORD '%s'; GRANT CONNECT ON DATABASE \"%s\" TO \"%s\";", roleName, pwd, flagRoleDB, roleName)
		} else {
			createSQL = fmt.Sprintf("CREATE ROLE \"%s\" WITH LOGIN PASSWORD '%s'; GRANT ALL PRIVILEGES ON DATABASE \"%s\" TO \"%s\";", roleName, pwd, flagRoleDB, roleName)
		}

		_, err := apiCli.ExecuteQuery(flagRoleDB, createSQL)
		if err != nil {
			return fmt.Errorf("failed to create role: %w", err)
		}

		fmt.Printf("✓ Role '%s' created for '%s'.\n", roleName, flagRoleDB)
		return nil
	},
}

var roleRotateCmd = &cobra.Command{
	Use:   "rotate <role_name>",
	Short: "Rotate password for a specific PostgreSQL role",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		roleName := args[0]
		fmt.Printf("Rotating credentials for role '%s'...\n", roleName)

		res, err := apiCli.RotateRole(roleName, flagRoleTerminateConns)
		if err != nil {
			return fmt.Errorf("failed to rotate role: %w", err)
		}

		if flagRoleJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ Role credentials rotated successfully!")
		if total, ok := res["terminated_sessions"].(float64); ok && total > 0 {
			fmt.Printf("⚡ Terminated %d active sessions holding old credentials.\n", int(total))
		}
		if pwd, ok := res["admin_password"].(string); ok && pwd != "" {
			fmt.Printf("New password: %s\n", pwd)
		}
		if uri, ok := res["admin_pooler_connection_string"].(string); ok && uri != "" {
			fmt.Printf("Pooler URI:   %s\n", uri)
		}
		return nil
	},
}

func init() {
	roleListCmd.Flags().StringVar(&flagRoleDB, "db", "", "Filter by database name")
	roleListCmd.Flags().BoolVar(&flagRoleJSON, "json", false, "Output as JSON")

	roleCreateCmd.Flags().StringVar(&flagRoleDB, "db", "", "Target database name")
	roleCreateCmd.Flags().BoolVar(&flagRoleReadOnly, "read-only", true, "Grant read-only SELECT permissions")

	roleRotateCmd.Flags().BoolVar(&flagRoleTerminateConns, "terminate-connections", true, "Terminate active PostgreSQL connections for this role")
	roleRotateCmd.Flags().BoolVar(&flagRoleJSON, "json", false, "Output as JSON")

	roleCmd.AddCommand(roleListCmd)
	roleCmd.AddCommand(roleCreateCmd)
	roleCmd.AddCommand(roleRotateCmd)
	rootCmd.AddCommand(roleCmd)
}
