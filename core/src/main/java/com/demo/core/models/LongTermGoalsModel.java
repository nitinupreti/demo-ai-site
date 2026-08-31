/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class LongTermGoalsModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String checkIcon;

    @ChildResource
    private List<LongTermGoalItemModel> goals;

    @PostConstruct
    protected void init() {
        if (goals == null) {
            goals = Collections.emptyList();
        } else {
            goals = goals.stream()
                    .filter(LongTermGoalItemModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public String getEyebrow() { return eyebrow; }
    public String getHeading() { return heading; }
    public String getDescription() { return description; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt; }
    public String getCheckIcon() { return checkIcon; }
    public List<LongTermGoalItemModel> getGoals() { return Collections.unmodifiableList(goals); }

    public boolean isHasContent() {
        return (eyebrow != null && !eyebrow.isEmpty())
                || (heading != null && !heading.isEmpty())
                || (description != null && !description.isEmpty())
                || (image != null && !image.isEmpty())
                || !goals.isEmpty();
    }
}
