package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var flagNodeJSON bool

var nodeCmd = &cobra.Command{
	Use:   "node",
	Short: "Inspect host node and PostgreSQL engine metrics",
}

var nodeStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Display node resource utilization and PostgreSQL parameters",
	RunE: func(cmd *cobra.Command, args []string) error {
		metrics, err := apiCli.GetNodeMetrics()
		if err != nil {
			return err
		}

		if flagNodeJSON {
			data, _ := json.MarshalIndent(metrics, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Node Host:        %v\n", metrics["node_host"])
		fmt.Printf("PostgreSQL:       %v\n", metrics["postgres_version"])
		fmt.Printf("Total Databases:  %v\n", metrics["total_databases"])
		fmt.Printf("Connections:      %v\n", metrics["total_connections"])
		fmt.Printf("Disk Usage:       %v\n", metrics["total_disk"])
		fmt.Printf("p99 Latency:      %v\n", metrics["p99_latency"])

		if meters, ok := metrics["meters"].([]any); ok {
			fmt.Println("\n=== Resource Meters ===")
			for _, m := range meters {
				meter, ok := m.(map[string]any)
				if !ok {
					continue
				}
				fmt.Printf("  %-8s %-6s (%s)\n", meter["label"], meter["value"], meter["detail"])
			}
		}

		if conf, ok := metrics["config"].(map[string]any); ok {
			fmt.Println("\n=== postgresql.conf ===")
			for k, v := range conf {
				fmt.Printf("  %-18s = %v\n", k, v)
			}
		}

		return nil
	},
}

func init() {
	nodeStatusCmd.Flags().BoolVar(&flagNodeJSON, "json", false, "Output as JSON")
	nodeCmd.AddCommand(nodeStatusCmd)
	rootCmd.AddCommand(nodeCmd)
}
