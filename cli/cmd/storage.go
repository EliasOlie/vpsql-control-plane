package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var (
	flagStorageJSON      bool
	flagStoragePublic    bool
	flagStorageProject   string
	flagStorageForce     bool
	flagStorageKey       string
	flagStoragePrefix    string
	flagPresignMethod    string
	flagPresignExpires   int64
)

var storageCmd = &cobra.Command{
	Use:     "storage",
	Aliases: []string{"s3", "bucket", "buckets"},
	Short:   "Manage S3-compliant static file storage buckets and objects",
}

var storageListCmd = &cobra.Command{
	Use:     "ls",
	Aliases: []string{"list"},
	Short:   "List provisioned S3 storage buckets",
	RunE: func(cmd *cobra.Command, args []string) error {
		list, err := apiCli.ListBuckets(flagStorageProject)
		if err != nil {
			return err
		}

		if flagStorageJSON {
			data, _ := json.MarshalIndent(list, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(list) == 0 {
			fmt.Println("No storage buckets found. Run 'vpsql storage create <name>' to provision one.")
			return nil
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "BUCKET\tPROJECT\tOBJECTS\tSIZE\tPUBLIC\tENDPOINT\tCREATED")
		for _, b := range list {
			fmt.Fprintf(w, "%v\t%v\t%v\t%v\t%v\t%v\t%v\n",
				b["name"], b["project_group"], b["object_count"], b["size_formatted"], b["is_public"], b["endpoint"], b["created"])
		}
		return w.Flush()
	},
}

var storageCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Provision a new S3-compliant storage bucket on the persistent volume",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		fmt.Printf("Provisioning S3 storage bucket '%s'...\n", name)
		resp, err := apiCli.CreateBucket(name, flagStorageProject, flagStoragePublic)
		if err != nil {
			return fmt.Errorf("storage provisioning failed: %w", err)
		}

		if flagStorageJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		bucket, _ := resp["bucket"].(map[string]any)
		fmt.Println("\n✓ S3 Storage Bucket provisioned successfully!")
		fmt.Printf("Bucket:          %v\n", bucket["name"])
		fmt.Printf("Project Group:   %v\n", bucket["project_group"])
		fmt.Printf("Public Access:   %v\n", bucket["is_public"])
		fmt.Printf("Endpoint URL:    %v\n", resp["endpoint"])
		fmt.Printf("Access Key ID:   %v\n", resp["access_key_id"])
		fmt.Printf("Secret Access:   %v\n", resp["secret_access_key"])
		fmt.Printf("Public Base URL: %v\n", resp["public_url"])
		fmt.Println("\nEnvironment variables (.env snippet):")
		fmt.Printf("%v\n", resp["env_snippet"])

		return nil
	},
}

var storageGetCmd = &cobra.Command{
	Use:     "info <name>",
	Aliases: []string{"get"},
	Short:   "Get details and credentials for a provisioned bucket",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		b, err := apiCli.GetBucket(name)
		if err != nil {
			return err
		}

		if flagStorageJSON {
			data, _ := json.MarshalIndent(b, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Bucket:          %v\n", b["name"])
		fmt.Printf("Project Group:   %v\n", b["project_group"])
		fmt.Printf("Public Read:     %v\n", b["is_public"])
		fmt.Printf("Status:          %v\n", b["status"])
		fmt.Printf("Objects:         %v\n", b["object_count"])
		fmt.Printf("Size:            %v\n", b["size_formatted"])
		fmt.Printf("Endpoint:        %v\n", b["endpoint"])
		fmt.Printf("Access Key ID:   %v\n", b["access_key"])
		fmt.Printf("Secret Access:   %v\n", b["secret_key"])
		fmt.Printf("Public URL Base: %v\n", b["public_url_base"])
		fmt.Printf("\n.env Snippet:\n%v\n", b["env_snippet"])
		return nil
	},
}

var storageRmCmd = &cobra.Command{
	Use:     "rm <name>",
	Aliases: []string{"drop", "delete"},
	Short:   "Drop an S3 bucket and permanently delete its files",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		if !flagStorageForce {
			fmt.Printf("Are you sure you want to delete bucket '%s' and all its files? [y/N]: ", name)
			var confirm string
			fmt.Scanln(&confirm)
			if confirm != "y" && confirm != "Y" {
				fmt.Println("Aborted.")
				return nil
			}
		}

		if err := apiCli.DeleteBucket(name); err != nil {
			return err
		}
		fmt.Printf("✓ Bucket '%s' dropped successfully.\n", name)
		return nil
	},
}

var storageObjectsCmd = &cobra.Command{
	Use:     "objects <bucket>",
	Aliases: []string{"files"},
	Short:   "List objects stored inside a bucket",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		bucket := args[0]
		resp, err := apiCli.ListBucketObjects(bucket, flagStoragePrefix)
		if err != nil {
			return err
		}

		if flagStorageJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		objs, _ := resp["objects"].([]any)
		if len(objs) == 0 {
			fmt.Printf("Bucket '%s' is empty.\n", bucket)
			return nil
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "KEY\tSIZE\tCONTENT TYPE\tPUBLIC URL\tMODIFIED")
		for _, raw := range objs {
			o, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			fmt.Fprintf(w, "%v\t%v\t%v\t%v\t%v\n",
				o["key"], o["size_formatted"], o["content_type"], o["public_url"], o["created"])
		}
		return w.Flush()
	},
}

var storageUploadCmd = &cobra.Command{
	Use:   "upload <bucket> <file>",
	Short: "Upload a local static file to an S3 storage bucket",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		bucket := args[0]
		file := args[1]

		fmt.Printf("Uploading %s to bucket '%s'...\n", file, bucket)
		obj, err := apiCli.UploadBucketObject(bucket, file, flagStorageKey)
		if err != nil {
			return err
		}

		fmt.Println("✓ Upload successful!")
		fmt.Printf("Key:        %v\n", obj["key"])
		fmt.Printf("Size:       %v\n", obj["size_formatted"])
		fmt.Printf("Public URL: %v\n", obj["public_url"])
		return nil
	},
}

var storagePresignCmd = &cobra.Command{
	Use:   "presign <bucket> <key>",
	Short: "Generate an AWS SigV4 presigned URL for secure temporary upload or download",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		bucket := args[0]
		key := args[1]

		resp, err := apiCli.PresignBucketObject(bucket, key, flagPresignMethod, flagPresignExpires)
		if err != nil {
			return err
		}

		if flagStorageJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("✓ Presigned URL (%v, expires in %vs):\n\n%v\n\nExpires At: %v\n",
			resp["method"], resp["expires_in_seconds"], resp["url"], resp["expires_at"])
		return nil
	},
}

var storageRotateCmd = &cobra.Command{
	Use:   "rotate <bucket_name>",
	Short: "Rotate SecretAccessKey for an S3 storage bucket",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]
		fmt.Printf("Rotating secret access key for storage bucket '%s'...\n", name)

		res, err := apiCli.RotateBucket(name)
		if err != nil {
			return fmt.Errorf("failed to rotate storage bucket credentials: %w", err)
		}

		if flagStorageJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("✓ S3 bucket credentials rotated successfully!")
		if sk, ok := res["secret_access_key"].(string); ok {
			fmt.Printf("New Secret Access Key: %s\n", sk)
		}
		if env, ok := res["env_snippet"].(string); ok {
			fmt.Printf("\nUpdated .env snippet:\n%s\n", env)
		}
		return nil
	},
}

func init() {
	storageListCmd.Flags().StringVarP(&flagStorageProject, "project", "p", "", "Filter by project group")
	storageListCmd.Flags().BoolVar(&flagStorageJSON, "json", false, "Output as JSON")

	storageCreateCmd.Flags().StringVarP(&flagStorageProject, "project", "p", "", "Project group association")
	storageCreateCmd.Flags().BoolVar(&flagStoragePublic, "public", true, "Enable public HTTP read access for static assets")
	storageCreateCmd.Flags().BoolVar(&flagStorageJSON, "json", false, "Output as JSON")

	storageGetCmd.Flags().BoolVar(&flagStorageJSON, "json", false, "Output as JSON")

	storageRmCmd.Flags().BoolVarP(&flagStorageForce, "force", "f", false, "Force delete without confirmation")

	storageObjectsCmd.Flags().StringVarP(&flagStoragePrefix, "prefix", "p", "", "Filter by object key prefix")
	storageObjectsCmd.Flags().BoolVar(&flagStorageJSON, "json", false, "Output as JSON")

	storageUploadCmd.Flags().StringVarP(&flagStorageKey, "key", "k", "", "Target object key name inside the bucket")

	storagePresignCmd.Flags().StringVarP(&flagPresignMethod, "method", "m", "GET", "HTTP method (GET or PUT)")
	storagePresignCmd.Flags().Int64VarP(&flagPresignExpires, "expires", "e", 3600, "Expiration in seconds (default 3600 = 1 hour)")
	storagePresignCmd.Flags().BoolVar(&flagStorageJSON, "json", false, "Output as JSON")

	storageRotateCmd.Flags().BoolVar(&flagStorageJSON, "json", false, "Output as JSON")

	storageCmd.AddCommand(storageListCmd)
	storageCmd.AddCommand(storageCreateCmd)
	storageCmd.AddCommand(storageGetCmd)
	storageCmd.AddCommand(storageRmCmd)
	storageCmd.AddCommand(storageObjectsCmd)
	storageCmd.AddCommand(storageUploadCmd)
	storageCmd.AddCommand(storagePresignCmd)
	storageCmd.AddCommand(storageRotateCmd)

	rootCmd.AddCommand(storageCmd)
}
