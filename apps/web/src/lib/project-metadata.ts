import { z } from "zod";

const githubRepoPattern = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => value ?? "")
  .refine((value) => value === "" || z.url().safeParse(value).success, "Enter a valid URL");

export const projectMetadataSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Project name must be at least 2 characters")
    .max(80, "Project name must be 80 characters or fewer"),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters")
    .max(600, "Description must be 600 characters or fewer"),
  socialUrl: optionalUrl,
  imageUrl: optionalUrl,
  githubRepo: z
    .string()
    .trim()
    .url("Enter a valid GitHub repo URL")
    .regex(githubRepoPattern, "Use a repo URL like https://github.com/org/repo"),
});

export type ProjectMetadataFormValues = z.infer<typeof projectMetadataSchema>;

export type ProjectMetadataDocument = {
  name: string;
  description: string;
  image?: string;
  external_url: string;
  properties: {
    githubRepo: string;
    socialUrl?: string;
    app: "SomniBounty AI";
    schema: "somnibounty.project.v1";
  };
};

export function buildProjectMetadataDocument(
  values: ProjectMetadataFormValues,
): ProjectMetadataDocument {
  return {
    name: values.name,
    description: values.description,
    ...(values.imageUrl ? { image: values.imageUrl } : {}),
    external_url: values.githubRepo,
    properties: {
      githubRepo: values.githubRepo,
      ...(values.socialUrl ? { socialUrl: values.socialUrl } : {}),
      app: "SomniBounty AI",
      schema: "somnibounty.project.v1",
    },
  };
}
