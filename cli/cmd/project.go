package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var (
	flagProjectsJSON bool
	flagProjectDesc  string
	flagProjectColor string
)

var projectCmd = &cobra.Command{
	Use:     "project",
	Aliases: []string{"projects", "workspace", "workspaces"},
	Short:   "View and manage resources grouped by projects (Databases, Cache, S3 Storage, AI)",
}

var projectCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create an explicit project group / workspace",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		res, err := apiCli.CreateProjectGroup(name, flagProjectDesc, flagProjectColor)
		if err != nil {
			return err
		}
		fmt.Printf("✓ Project '%s' created successfully (ID: %v)\n", res["name"], res["id"])
		return nil
	},
}

var projectDeleteCmd = &cobra.Command{
	Use:     "rm <name>",
	Aliases: []string{"delete"},
	Short:   "Delete a project group (reassigns orphaned resources to default)",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		_, err := apiCli.DeleteProjectGroup(name)
		if err != nil {
			return err
		}
		fmt.Printf("✓ Project '%s' deleted. Orphaned resources moved to 'default'.\n", name)
		return nil
	},
}

var projectAttachCmd = &cobra.Command{
	Use:   "attach <project> <type> <resource_id>",
	Short: "Attach an existing resource (database, redis, storage, ai) to a project",
	Long:  "Attach resource to a project. Valid types: database (or db), redis (or cache), storage (or s3), ai (or key)",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		proj := args[0]
		resType := args[1]
		resID := args[2]

		res, err := apiCli.AttachResourceToProject(proj, resType, resID)
		if err != nil {
			return err
		}
		fmt.Printf("✓ Resource '%s' (%s) attached to project '%s'\n", resID, resType, proj)
		_ = res
		return nil
	},
}

var projectDetachCmd = &cobra.Command{
	Use:   "detach <project> <type> <resource_id>",
	Short: "Detach a resource from a project (reassigns to default)",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		proj := args[0]
		resType := args[1]
		resID := args[2]

		_, err := apiCli.DetachResourceFromProject(proj, resType, resID)
		if err != nil {
			return err
		}
		fmt.Printf("✓ Resource '%s' detached from project '%s' (moved to default)\n", resID, proj)
		return nil
	},
}

var projectListCmd = &cobra.Command{
	Use:     "ls",
	Aliases: []string{"list"},
	Short:   "List all projects and their provisioned resources (Databases, Redis, S3, AI)",
	RunE: func(cmd *cobra.Command, args []string) error {
		resp, err := apiCli.GetGroupedProjects()
		if err != nil {
			return err
		}

		if flagProjectsJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		projects, _ := resp["projects"].([]any)
		if len(projects) == 0 {
			fmt.Println("No projects found.")
			return nil
		}

		fmt.Printf("VPSQL Project Hub — %d project(s), %v total resource(s)\n\n",
			len(projects), resp["total_resources"])

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "PROJECT\tRESOURCES\tDATABASES\tREDIS\tSTORAGE (S3)\tAI KEYS")

		for _, raw := range projects {
			p, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			dbs, _ := p["databases"].([]any)
			redisList, _ := p["redis"].([]any)
			buckets, _ := p["buckets"].([]any)
			aiKeys, _ := p["ai_keys"].([]any)

			fmt.Fprintf(w, "%v\t%v\t%d db(s)\t%d cache(s)\t%d bucket(s)\t%d key(s)\n",
				p["name"], p["total_resources"], len(dbs), len(redisList), len(buckets), len(aiKeys))
		}
		_ = w.Flush()

		// Print detailed breakdown per project
		fmt.Println("\nResource Details by Project:")
		for _, raw := range projects {
			p, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			name := p["name"]
			fmt.Printf("\n▶ Project: %s\n", name)

			dbs, _ := p["databases"].([]any)
			if len(dbs) > 0 {
				fmt.Printf("  • Databases (%d):\n", len(dbs))
				for _, rawDb := range dbs {
					d, _ := rawDb.(map[string]any)
					fmt.Printf("    - %v (db: %v, size: %v, conns: %v)\n", d["name"], d["db_name"], d["size"], d["conns"])
				}
			}

			redisList, _ := p["redis"].([]any)
			if len(redisList) > 0 {
				fmt.Printf("  • Redis Caches (%d):\n", len(redisList))
				for _, rawR := range redisList {
					r, _ := rawR.(map[string]any)
					fmt.Printf("    - %v (prefix: %v, status: %v)\n", r["name"], r["key_prefix"], r["status"])
				}
			}

			buckets, _ := p["buckets"].([]any)
			if len(buckets) > 0 {
				fmt.Printf("  • S3 Buckets (%d):\n", len(buckets))
				for _, rawB := range buckets {
					b, _ := rawB.(map[string]any)
					fmt.Printf("    - %v (objects: %v, size: %v, public: %v)\n", b["name"], b["object_count"], b["size_formatted"], b["is_public"])
				}
			}

			aiKeys, _ := p["ai_keys"].([]any)
			if len(aiKeys) > 0 {
				fmt.Printf("  • AI Keys (%d):\n", len(aiKeys))
				for _, rawK := range aiKeys {
					k, _ := rawK.(map[string]any)
					fmt.Printf("    - %v (%v, active: %v)\n", k["name"], k["key_prefix"], k["is_active"])
				}
			}
		}

		return nil
	},
}

func init() {
	projectListCmd.Flags().BoolVar(&flagProjectsJSON, "json", false, "Output as JSON")

	projectCreateCmd.Flags().StringVar(&flagProjectDesc, "desc", "", "Optional project description")
	projectCreateCmd.Flags().StringVar(&flagProjectColor, "color", "", "Optional project hex color (e.g. #5B8CFF)")

	projectCmd.AddCommand(projectListCmd)
	projectCmd.AddCommand(projectCreateCmd)
	projectCmd.AddCommand(projectDeleteCmd)
	projectCmd.AddCommand(projectAttachCmd)
	projectCmd.AddCommand(projectDetachCmd)
	rootCmd.AddCommand(projectCmd)
}
