package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var (
	flagRotateScope          string
	flagRotateTerminateConns bool
	flagRotateJSON           bool
	flagRotateRole           string
)

var rotateCmd = &cobra.Command{
	Use:   "rotate",
	Short: "Rotate leaked or expired credentials (granular per resource or bulk across all)",
}

var rotateAllCmd = &cobra.Command{
	Use:   "all",
	Short: "Rotate ALL credentials across databases, Redis, S3 storage, and AI keys",
	RunE: func(cmd *cobra.Command, args []string) error {
		scope := flagRotateScope
		if scope == "" {
			scope = "all"
		}
		fmt.Printf("⚠️  Rotating ALL credentials in scope '%s' (terminate active connections: %t)...\n", scope, flagRotateTerminateConns)

		res, err := apiCli.RotateAll(scope, flagRotateTerminateConns)
		if err != nil {
			return fmt.Errorf("bulk rotation failed: %w", err)
		}

		if flagRotateJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("\n✓ Bulk rotation complete!")
		if msg, ok := res["message"].(string); ok {
			fmt.Println(msg)
		}
		fmt.Printf("  • Databases rotated:  %v\n", res["databases_rotated"])
		fmt.Printf("  • Redis namespaces:   %v\n", res["redis_rotated"])
		fmt.Printf("  • S3 Buckets:         %v\n", res["buckets_rotated"])
		fmt.Printf("  • AI Gateway keys:    %v\n", res["ai_keys_rotated"])
		if term, ok := res["terminated_sessions"].(float64); ok && term > 0 {
			fmt.Printf("  • Terminated sessions: %d\n", int(term))
		}
		return nil
	},
}

var rotateDbCmd = &cobra.Command{
	Use:   "db <name>",
	Short: "Rotate credentials for a specific database",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		role := flagRotateRole
		if role == "" {
			role = "all"
		}
		fmt.Printf("Rotating '%s' credentials for database '%s'...\n", role, id)

		res, err := apiCli.RotateDatabase(id, role, flagRotateTerminateConns)
		if err != nil {
			return fmt.Errorf("failed to rotate database: %w", err)
		}

		if flagRotateJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ Database credentials rotated successfully!")
		if total, ok := res["terminated_sessions"].(float64); ok && total > 0 {
			fmt.Printf("⚡ Terminated %d active sessions.\n", int(total))
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

var rotateRoleCmd = &cobra.Command{
	Use:   "role <role_name>",
	Short: "Rotate credentials for a specific PostgreSQL role",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		roleName := args[0]
		fmt.Printf("Rotating credentials for role '%s'...\n", roleName)

		res, err := apiCli.RotateRole(roleName, flagRotateTerminateConns)
		if err != nil {
			return fmt.Errorf("failed to rotate role: %w", err)
		}

		if flagRotateJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ Role credentials rotated successfully!")
		if total, ok := res["terminated_sessions"].(float64); ok && total > 0 {
			fmt.Printf("⚡ Terminated %d active sessions.\n", int(total))
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

var rotateRedisCmd = &cobra.Command{
	Use:   "redis <id>",
	Short: "Rotate password for a Redis tenant namespace",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		fmt.Printf("Rotating Redis namespace '%s' credentials...\n", id)

		res, err := apiCli.RotateRedis(id)
		if err != nil {
			return fmt.Errorf("failed to rotate redis: %w", err)
		}

		if flagRotateJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ Redis credentials rotated and client connections reset successfully!")
		if connStr, ok := res["connection_string"].(string); ok {
			fmt.Printf("Connection URI: %s\n", connStr)
		}
		return nil
	},
}

var rotateStorageCmd = &cobra.Command{
	Use:   "storage <bucket_name>",
	Short: "Rotate SecretAccessKey for an S3 storage bucket",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		fmt.Printf("Rotating secret access key for storage bucket '%s'...\n", name)

		res, err := apiCli.RotateBucket(name)
		if err != nil {
			return fmt.Errorf("failed to rotate storage bucket: %w", err)
		}

		if flagRotateJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ S3 bucket credentials rotated successfully!")
		if sk, ok := res["secret_access_key"].(string); ok {
			fmt.Printf("New Secret Access Key: %s\n", sk)
		}
		return nil
	},
}

var rotateAICmd = &cobra.Command{
	Use:   "ai <key_id>",
	Short: "Rotate an AI Gateway API key",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		fmt.Printf("Rotating AI Key '%s'...\n", id)

		res, err := apiCli.RotateAIKey(id)
		if err != nil {
			return fmt.Errorf("failed to rotate AI key: %w", err)
		}

		if flagRotateJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ AI Gateway API Key rotated successfully!")
		if rawKey, ok := res["raw_key"].(string); ok && rawKey != "" {
			fmt.Printf("New Virtual Key: %s\n", rawKey)
			fmt.Println("(Note: This secret key will not be displayed again!)")
		}
		return nil
	},
}

func init() {
	rotateAllCmd.Flags().StringVarP(&flagRotateScope, "scope", "s", "all", "Scope: 'all' or workspace/project-group name")
	rotateAllCmd.Flags().BoolVar(&flagRotateTerminateConns, "terminate-connections", true, "Terminate active connections holding old credentials")
	rotateAllCmd.Flags().BoolVar(&flagRotateJSON, "json", false, "Output as JSON")

	rotateDbCmd.Flags().StringVar(&flagRotateRole, "role", "all", "Role to rotate: admin, readonly, or all")
	rotateDbCmd.Flags().BoolVar(&flagRotateTerminateConns, "terminate-connections", true, "Terminate active connections for rotated roles")
	rotateDbCmd.Flags().BoolVar(&flagRotateJSON, "json", false, "Output as JSON")

	rotateRoleCmd.Flags().BoolVar(&flagRotateTerminateConns, "terminate-connections", true, "Terminate active connections for rotated roles")
	rotateRoleCmd.Flags().BoolVar(&flagRotateJSON, "json", false, "Output as JSON")

	rotateRedisCmd.Flags().BoolVar(&flagRotateJSON, "json", false, "Output as JSON")
	rotateStorageCmd.Flags().BoolVar(&flagRotateJSON, "json", false, "Output as JSON")
	rotateAICmd.Flags().BoolVar(&flagRotateJSON, "json", false, "Output as JSON")

	rotateCmd.AddCommand(rotateAllCmd)
	rotateCmd.AddCommand(rotateDbCmd)
	rotateCmd.AddCommand(rotateRoleCmd)
	rotateCmd.AddCommand(rotateRedisCmd)
	rotateCmd.AddCommand(rotateStorageCmd)
	rotateCmd.AddCommand(rotateAICmd)

	rootCmd.AddCommand(rotateCmd)
}
