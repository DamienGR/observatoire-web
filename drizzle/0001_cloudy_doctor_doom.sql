ALTER TABLE "commune" DROP CONSTRAINT "commune_population_positive";--> statement-breakpoint
ALTER TABLE "commune" ADD CONSTRAINT "commune_population_not_negative" CHECK ("commune"."population" >= 0);