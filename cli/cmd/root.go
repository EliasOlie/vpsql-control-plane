package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/vpsql/cli/internal/client"
	"github.com/vpsql/cli/internal/config"
)

var (
	flagEndpoint string
	flagToken    string
	apiCli       *client.APIClient
	cliConfig    *config.CLIConfig
)

var rootCmd = &cobra.Command{
	Use:   "vpsql",
	Short: "VPSQL Control Plane CLI - Provision and manage PostgreSQL instances",
	Long: `VPSQL is a production-grade single-node PostgreSQL manager.
Provision isolated tenant databases, manage admin and read-only roles,
inspect schemas, and proxy queries with ease.`,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		var err error
		cliConfig, err = config.LoadConfig()
		if err != nil {
			return err
		}

		endpoint := flagEndpoint
		if endpoint == "" {
			endpoint = os.Getenv("VPSQL_ENDPOINT")
		}
		if endpoint == "" {
			endpoint = cliConfig.Endpoint
		}
		if endpoint == "" {
			endpoint = "http://localhost:8080"
		}

		token := flagToken
		if token == "" {
			token = os.Getenv("VPSQL_TOKEN")
		}
		if token == "" {
			token = cliConfig.Token
		}

		apiCli = client.New(endpoint, token)
		return nil
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().StringVar(&flagEndpoint, "endpoint", "", "VPSQL API endpoint (default: http://localhost:8080 or config)")
	rootCmd.PersistentFlags().StringVar(&flagToken, "token", "", "VPSQL API Bearer Token")
}
