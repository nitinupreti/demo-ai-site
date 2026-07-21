/*
 *  Copyright 2026 Adobe Systems Incorporated
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.day.cq.wcm.api.Page;
import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

/**
 * Unit tests for {@link BenefitModel} and {@link BenefitItem}.
 */
@ExtendWith(AemContextExtension.class)
class BenefitModelTest {

    private static final String RESOURCE_TYPE = "demo-ai-site/components/benefit";

    private final AemContext context = AppAemContext.newAemContext();

    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(BenefitModel.class, BenefitItem.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCompleteData() {
        Resource benefit = context.create().resource(page, "benefit",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Smart Finance for everyone",
                "description", "At Noble Finance, we believe financial confidence should be accessible to everyone.");

        context.create().resource(benefit, "benefitContent");
        context.create().resource(benefit.getPath() + "/benefitContent/item0",
                "icon", "/content/dam/demo-ai-site/icons/folder.svg",
                "title", "For Freelancers",
                "description", "<p>Stay in charge of your income with <b>seamless</b> expense tracking.</p>");
        context.create().resource(benefit.getPath() + "/benefitContent/item1",
                "icon", "/content/dam/demo-ai-site/icons/person.svg",
                "title", "For Families",
                "description", "<p>From budgeting tools to tax-saving insights.</p>");

        BenefitModel model = benefit.adaptTo(BenefitModel.class);

        assertNotNull(model);
        assertEquals("Smart Finance for everyone", model.getTitle());
        assertEquals("At Noble Finance, we believe financial confidence should be accessible to everyone.",
                model.getDescription());
        assertTrue(model.isHasContent());

        List<BenefitItem> items = model.getBenefits();
        assertNotNull(items);
        assertEquals(2, items.size());

        BenefitItem first = items.get(0);
        assertEquals("/content/dam/demo-ai-site/icons/folder.svg", first.getIcon());
        assertEquals("For Freelancers", first.getTitle());
        assertEquals("<p>Stay in charge of your income with <b>seamless</b> expense tracking.</p>",
                first.getDescription());
    }

    @Test
    void testItemWithoutRequiredFieldsIsFiltered() {
        Resource benefit = context.create().resource(page, "benefit",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Benefits",
                "description", "Overview");

        context.create().resource(benefit, "benefitContent");
        context.create().resource(benefit.getPath() + "/benefitContent/item0",
                "icon", "/content/dam/demo-ai-site/icons/folder.svg",
                "title", "For Freelancers",
                "description", "<p>Valid item.</p>");
        // Missing icon - should be filtered out
        context.create().resource(benefit.getPath() + "/benefitContent/item1",
                "title", "Broken",
                "description", "<p>No icon</p>");
        // Missing description - should be filtered out
        context.create().resource(benefit.getPath() + "/benefitContent/item2",
                "icon", "/content/dam/demo-ai-site/icons/x.svg",
                "title", "No description");

        BenefitModel model = benefit.adaptTo(BenefitModel.class);

        assertNotNull(model);
        List<BenefitItem> items = model.getBenefits();
        assertEquals(1, items.size());
        assertEquals("For Freelancers", items.get(0).getTitle());
    }

    @Test
    void testHasContentFalseWhenNoBenefits() {
        Resource resource = context.create().resource(page, "benefit",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Only title",
                "description", "Only description");

        BenefitModel model = resource.adaptTo(BenefitModel.class);

        assertNotNull(model);
        assertFalse(model.isHasContent());
        assertTrue(model.getBenefits().isEmpty());
    }

    @Test
    void testHasContentFalseWhenNoTitle() {
        Resource benefit = context.create().resource(page, "benefit",
                "sling:resourceType", RESOURCE_TYPE,
                "description", "Description only");
        context.create().resource(benefit, "benefitContent");
        context.create().resource(benefit.getPath() + "/benefitContent/item0",
                "icon", "/content/dam/demo-ai-site/icons/folder.svg",
                "title", "For Freelancers",
                "description", "<p>Valid.</p>");

        BenefitModel model = benefit.adaptTo(BenefitModel.class);

        assertNotNull(model);
        assertFalse(model.isHasContent());
    }

    @Test
    void testHasContentFalseWhenNoDescription() {
        Resource benefit = context.create().resource(page, "benefit",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Title only");
        context.create().resource(benefit, "benefitContent");
        context.create().resource(benefit.getPath() + "/benefitContent/item0",
                "icon", "/content/dam/demo-ai-site/icons/folder.svg",
                "title", "For Freelancers",
                "description", "<p>Valid.</p>");

        BenefitModel model = benefit.adaptTo(BenefitModel.class);

        assertNotNull(model);
        assertFalse(model.isHasContent());
    }

}
