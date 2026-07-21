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
import static org.junit.jupiter.api.Assertions.assertNull;
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
 * Unit tests for {@link TestimonialModel} and {@link TestimonialItem}.
 */
@ExtendWith(AemContextExtension.class)
class TestimonialModelTest {

    private static final String RESOURCE_TYPE = "demo-ai-site/components/testimonial";

    private final AemContext context = AppAemContext.newAemContext();

    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(TestimonialModel.class, TestimonialItem.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCompleteData() {
        Resource testimonial = context.create().resource(page, "testimonial",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Hear From Our Happy Clients");

        context.create().resource(testimonial, "testimonials");
        context.create().resource(testimonial.getPath() + "/testimonials/item0",
                "jobRole", "Graphic Designer",
                "location", "Ontario, Canada",
                "citation", "Managing my taxes as a freelancer used to be overwhelming.",
                "image", "/content/dam/demo-ai-site/taylor.jpg",
                "name", "Taylor M.",
                "age", 28L);
        context.create().resource(testimonial.getPath() + "/testimonials/item1",
                "jobRole", "Commercial Photographer",
                "location", "Ontario, Canada",
                "citation", "Noble Finance made everything effortless.",
                "image", "/content/dam/demo-ai-site/alex.jpg",
                "name", "Alex P.",
                "age", 34L);

        TestimonialModel model = testimonial.adaptTo(TestimonialModel.class);

        assertNotNull(model);
        assertEquals("Hear From Our Happy Clients", model.getTitle());
        assertTrue(model.isHasContent());

        List<TestimonialItem> items = model.getTestimonials();
        assertNotNull(items);
        assertEquals(2, items.size());

        TestimonialItem first = items.get(0);
        assertEquals("Graphic Designer", first.getJobRole());
        assertEquals("Ontario, Canada", first.getLocation());
        assertEquals("Managing my taxes as a freelancer used to be overwhelming.", first.getCitation());
        assertEquals("/content/dam/demo-ai-site/taylor.jpg", first.getImage());
        assertEquals("Taylor M.", first.getName());
        assertEquals(Integer.valueOf(28), first.getAge());
    }

    @Test
    void testItemWithoutRequiredFieldsIsFiltered() {
        Resource testimonial = context.create().resource(page, "testimonial",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Testimonials");

        context.create().resource(testimonial, "testimonials");
        context.create().resource(testimonial.getPath() + "/testimonials/item0",
                "jobRole", "Stylist",
                "location", "Austin, Texas",
                "citation", "Great service.",
                "image", "/content/dam/demo-ai-site/sam.jpg",
                "name", "Sam K.",
                "age", 40L);
        // Missing image - should be filtered out
        context.create().resource(testimonial.getPath() + "/testimonials/item1",
                "jobRole", "Broken",
                "location", "Nowhere",
                "citation", "No image",
                "name", "Anon");

        TestimonialModel model = testimonial.adaptTo(TestimonialModel.class);

        assertNotNull(model);
        List<TestimonialItem> items = model.getTestimonials();
        assertEquals(1, items.size());
        assertEquals("Stylist", items.get(0).getJobRole());
    }

    @Test
    void testAgeIsOptional() {
        Resource testimonial = context.create().resource(page, "testimonial",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Testimonials");

        context.create().resource(testimonial, "testimonials");
        context.create().resource(testimonial.getPath() + "/testimonials/item0",
                "jobRole", "Designer",
                "location", "Berlin",
                "citation", "Loved it.",
                "image", "/content/dam/demo-ai-site/anna.jpg",
                "name", "Anna");

        TestimonialModel model = testimonial.adaptTo(TestimonialModel.class);

        assertNotNull(model);
        assertEquals(1, model.getTestimonials().size());
        assertNull(model.getTestimonials().get(0).getAge());
        assertTrue(model.isHasContent());
    }

    @Test
    void testHasContentFalseWhenNoTestimonials() {
        Resource resource = context.create().resource(page, "testimonial",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Only title");

        TestimonialModel model = resource.adaptTo(TestimonialModel.class);

        assertNotNull(model);
        assertFalse(model.isHasContent());
        assertTrue(model.getTestimonials().isEmpty());
    }

    @Test
    void testHasContentFalseWhenNoTitle() {
        Resource testimonial = context.create().resource(page, "testimonial",
                "sling:resourceType", RESOURCE_TYPE);
        context.create().resource(testimonial, "testimonials");
        context.create().resource(testimonial.getPath() + "/testimonials/item0",
                "jobRole", "Designer",
                "location", "Berlin",
                "citation", "Loved it.",
                "image", "/content/dam/demo-ai-site/anna.jpg",
                "name", "Anna",
                "age", 30L);

        TestimonialModel model = testimonial.adaptTo(TestimonialModel.class);

        assertNotNull(model);
        assertFalse(model.isHasContent());
    }

}
