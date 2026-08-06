CREATE TABLE "commune" (
	"code_insee" text PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"population" integer NOT NULL,
	"departement" text NOT NULL,
	"region" text NOT NULL,
	"epci" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commune_code_insee_length" CHECK (char_length("commune"."code_insee") = 5),
	CONSTRAINT "commune_population_positive" CHECK ("commune"."population" > 0)
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"measurement_id" bigint NOT NULL,
	"rule_id" text NOT NULL,
	"impact" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "finding_impact_known" CHECK ("finding"."impact" in ('minor', 'moderate', 'serious', 'critical')),
	CONSTRAINT "finding_occurrences_positive" CHECK ("finding"."occurrences" > 0)
);
--> statement-breakpoint
CREATE TABLE "measurement" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scan_run_id" bigint NOT NULL,
	"site_id" bigint NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"statut" text DEFAULT 'pending' NOT NULL,
	"methodology_version" text NOT NULL,
	"fetched_at" timestamp with time zone,
	"http_status" integer,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"performance_score" smallint,
	"accessibility_score" smallint,
	"best_practices_score" smallint,
	"seo_score" smallint,
	"lcp_ms" integer,
	"fcp_ms" integer,
	"speed_index_ms" integer,
	"tbt_ms" integer,
	"tti_ms" integer,
	"cls" double precision,
	"has_accessibility_statement" boolean,
	"accessibility_statement_url" text,
	"has_legal_notice" boolean,
	"has_privacy_policy" boolean,
	"has_hsts" boolean,
	"has_csp" boolean,
	"has_x_content_type_options" boolean,
	"cms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_statut_known" CHECK ("measurement"."statut" in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
	CONSTRAINT "measurement_methodology_version_present" CHECK (char_length("measurement"."methodology_version") > 0),
	CONSTRAINT "measurement_attempts_positive" CHECK ("measurement"."attempts" >= 0),
	CONSTRAINT "measurement_scores_in_range" CHECK (
        ("measurement"."performance_score" is null or "measurement"."performance_score" between 0 and 100)
        and ("measurement"."accessibility_score" is null or "measurement"."accessibility_score" between 0 and 100)
        and ("measurement"."best_practices_score" is null or "measurement"."best_practices_score" between 0 and 100)
        and ("measurement"."seo_score" is null or "measurement"."seo_score" between 0 and 100)
      ),
	CONSTRAINT "measurement_metrics_positive" CHECK (
        ("measurement"."lcp_ms" is null or "measurement"."lcp_ms" >= 0)
        and ("measurement"."fcp_ms" is null or "measurement"."fcp_ms" >= 0)
        and ("measurement"."speed_index_ms" is null or "measurement"."speed_index_ms" >= 0)
        and ("measurement"."tbt_ms" is null or "measurement"."tbt_ms" >= 0)
        and ("measurement"."tti_ms" is null or "measurement"."tti_ms" >= 0)
        and ("measurement"."cls" is null or "measurement"."cls" >= 0)
      )
);
--> statement-breakpoint
CREATE TABLE "scan_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"statut" text DEFAULT 'running' NOT NULL,
	"methodology_version" text NOT NULL,
	CONSTRAINT "scan_run_statut_known" CHECK ("scan_run"."statut" in ('running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "scan_run_methodology_version_present" CHECK (char_length("scan_run"."methodology_version") > 0),
	CONSTRAINT "scan_run_finished_at_matches_statut" CHECK (("scan_run"."statut" = 'running') = ("scan_run"."finished_at" is null))
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"commune_id" text NOT NULL,
	"url" text NOT NULL,
	"statut_resolution" text DEFAULT 'candidat' NOT NULL,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_statut_resolution_known" CHECK ("site"."statut_resolution" in ('candidat', 'verifie', 'invalide', 'a_revoir')),
	CONSTRAINT "site_source_known" CHECK ("site"."source" in ('annuaire', 'heuristique', 'manuel'))
);
--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_measurement_id_measurement_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."measurement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_scan_run_id_scan_run_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_commune_id_commune_code_insee_fk" FOREIGN KEY ("commune_id") REFERENCES "public"."commune"("code_insee") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commune_departement_idx" ON "commune" USING btree ("departement");--> statement-breakpoint
CREATE INDEX "commune_region_idx" ON "commune" USING btree ("region");--> statement-breakpoint
CREATE INDEX "commune_population_idx" ON "commune" USING btree ("population");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_measurement_rule_key" ON "finding" USING btree ("measurement_id","rule_id");--> statement-breakpoint
CREATE INDEX "finding_rule_idx" ON "finding" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_run_site_key" ON "measurement" USING btree ("scan_run_id","site_id");--> statement-breakpoint
CREATE INDEX "measurement_run_statut_idx" ON "measurement" USING btree ("scan_run_id","statut");--> statement-breakpoint
CREATE INDEX "measurement_site_fetched_at_idx" ON "measurement" USING btree ("site_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scan_run_statut_idx" ON "scan_run" USING btree ("statut");--> statement-breakpoint
CREATE INDEX "scan_run_started_at_idx" ON "scan_run" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_commune_url_key" ON "site" USING btree ("commune_id","url");--> statement-breakpoint
CREATE INDEX "site_commune_idx" ON "site" USING btree ("commune_id");--> statement-breakpoint
CREATE INDEX "site_statut_resolution_idx" ON "site" USING btree ("statut_resolution");